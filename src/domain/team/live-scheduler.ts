/**
 * Pure scheduling policy for the Team live/background poll cadence.
 *
 * V2.2 through V2.4 polled on a fixed open/closed cadence: 700ms live / 4s
 * background while a conversation was open, 1.2s live / 15s background while
 * it was not. `TeamMessagesDrawer` mounts for every internal session on every
 * page (it owns the unread badge and the transient peek toast), so the
 * "closed" cadence ran continuously, all day, for every signed-in employee —
 * that is what drove the Vercel invocation/duration spike this module exists
 * to fix, not actual chat traffic.
 *
 * Everything here is a pure function of explicit inputs (no `Date.now()`, no
 * `Math.random()` unless a caller opts in) so the policy is testable without
 * fake timers or a DOM. `src/components/team/use-team-sync-controller.ts` is
 * the only caller that owns real timers, `document.visibilityState` and
 * `navigator.onLine`.
 */

import { TEAM_CLOSED_SYNC_INTERVAL_MS } from "../background-polling";

export type TeamLiveTier = "fast" | "warm" | "quiet";

/** Live-lane interval while a conversation is open, by tier. */
export const TEAM_LIVE_FAST_MS = 700;
export const TEAM_LIVE_WARM_MS = 1_200;
export const TEAM_LIVE_QUIET_MS = 2_000;

/**
 * Live-lane interval while the drawer is closed (no conversation visible).
 * `app_team_live_sync` already returns `detail: null` whenever no
 * conversation id is sent — closed polling never asked for transcript detail
 * — the current 60s cadence reduces idle calls while focus/visibility return
 * still reconciles immediately.
 */
export const TEAM_LIVE_CLOSED_MS = TEAM_CLOSED_SYNC_INTERVAL_MS;

/** Background-lane interval while open, by tier. */
export const TEAM_BACKGROUND_OPEN_MS = 4_000;
export const TEAM_BACKGROUND_QUIET_MS = 10_000;

/** Background-lane interval while closed. */
export const TEAM_BACKGROUND_CLOSED_MS = TEAM_CLOSED_SYNC_INTERVAL_MS;

/**
 * How long the scheduler stays FAST after the last local activity or
 * detected remote change, and how much additional quiet time it then spends
 * WARM before dropping to QUIET. Chosen so a real back-and-forth
 * conversation (multi-second gaps between messages while still "in" the
 * chat) never leaves FAST, while a conversation left open and untouched
 * settles to the cheaper cadence within ~20s.
 */
export const TEAM_FAST_HOLD_MS = 5_000;
export const TEAM_WARM_HOLD_MS = 15_000;

/**
 * Bounded exponential backoff for consecutive transient failures, applied
 * per lane. Covers authorization failures (401/403) too — the goal is "does
 * not hot-loop against a broken or expired session", not distinguishing
 * error shapes the client already treats uniformly (`TeamActionResult`
 * carries no HTTP status).
 */
export const TEAM_BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 15_000] as const;

/** ±8%, inside the ±5-10% the brief asks for to avoid a thundering herd. */
export const TEAM_JITTER_RATIO = 0.08;

/** How many of the most recent messages the change fingerprint considers. */
const FINGERPRINT_MESSAGE_WINDOW = 50;

export function nextTeamLiveTier(msSinceActivity: number): TeamLiveTier {
  if (msSinceActivity < TEAM_FAST_HOLD_MS) return "fast";
  if (msSinceActivity < TEAM_FAST_HOLD_MS + TEAM_WARM_HOLD_MS) return "warm";
  return "quiet";
}

export function teamLiveIntervalMs(tier: TeamLiveTier): number {
  switch (tier) {
    case "fast":
      return TEAM_LIVE_FAST_MS;
    case "warm":
      return TEAM_LIVE_WARM_MS;
    case "quiet":
      return TEAM_LIVE_QUIET_MS;
  }
}

export function teamBackgroundIntervalMs(tier: TeamLiveTier): number {
  return tier === "quiet" ? TEAM_BACKGROUND_QUIET_MS : TEAM_BACKGROUND_OPEN_MS;
}

/** 0 when there is no active failure streak; otherwise the bounded backoff delay. */
export function teamBackoffIntervalMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  const index = Math.min(failureCount - 1, TEAM_BACKOFF_STEPS_MS.length - 1);
  return TEAM_BACKOFF_STEPS_MS[index] as number;
}

/** `random` is injectable so tests can assert exact bounds deterministically. */
export function applyTeamJitter(ms: number, random: () => number = Math.random): number {
  if (ms <= 0) return ms;
  const span = ms * TEAM_JITTER_RATIO;
  const jittered = ms - span + random() * span * 2;
  return Math.max(0, Math.round(jittered));
}

/**
 * The delay before the NEXT scheduled (non-immediate) live-lane tick.
 * Backoff only ever lengthens the wait relative to the tier baseline, never
 * shortens it below what the tier itself would already use.
 */
export function computeTeamLiveDelayMs(params: {
  open: boolean;
  tier: TeamLiveTier;
  failureCount: number;
  random?: () => number;
}): number {
  const base = params.open ? teamLiveIntervalMs(params.tier) : TEAM_LIVE_CLOSED_MS;
  const backoff = teamBackoffIntervalMs(params.failureCount);
  return applyTeamJitter(Math.max(base, backoff), params.random);
}

export function computeTeamBackgroundDelayMs(params: {
  open: boolean;
  tier: TeamLiveTier;
  failureCount: number;
  random?: () => number;
}): number {
  const base = params.open ? teamBackgroundIntervalMs(params.tier) : TEAM_BACKGROUND_CLOSED_MS;
  const backoff = teamBackoffIntervalMs(params.failureCount);
  return applyTeamJitter(Math.max(base, backoff), params.random);
}

/**
 * A minimal shape covering just what the fingerprint reads, so this module
 * never has to import the full `TeamConversationDetailRow` type and its
 * transitive schema graph.
 */
type FingerprintableDetail = {
  messages: Array<{
    id: string;
    deleted_for_everyone?: boolean;
    voice_expired_at?: string | null;
    reactions?: Array<{ reaction_code: string; reaction_count: number }>;
  }>;
  typing?: Array<{ profile_id: string; last_typed_at: string }>;
  pins?: Array<{ id: string; message_id: string; unpinned_at: string | null }>;
} | null;

/**
 * A cheap structural signature of "what a viewer would notice changed" in an
 * open conversation: the tail of messages (id, tombstone state, reaction
 * counts) plus who is typing. Two detail snapshots with an equal fingerprint
 * are indistinguishable to the person looking at the screen; an unequal one
 * is a meaningful remote change and should promote the scheduler to FAST.
 *
 * Bounded to the last `FINGERPRINT_MESSAGE_WINDOW` messages — new activity
 * always appends at the tail, and a reaction landing 300 messages back while
 * the viewer is idle is not worth the cost of fingerprinting the whole
 * transcript on every tick.
 */
export function teamDetailFingerprint(detail: FingerprintableDetail): string {
  if (!detail) return "";
  const tail = detail.messages.slice(-FINGERPRINT_MESSAGE_WINDOW);
  const messagePart = tail
    .map((message) => {
      const reactions = (message.reactions ?? [])
        .map((reaction) => `${reaction.reaction_code}:${reaction.reaction_count}`)
        .join(",");
      return `${message.id}:${message.deleted_for_everyone ? 1 : 0}:${message.voice_expired_at ?? ""}:${reactions}`;
    })
    .join("|");
  const typingPart = (detail.typing ?? [])
    .map((entry) => `${entry.profile_id}@${entry.last_typed_at}`)
    .join(",");
  const pinPart = (detail.pins ?? [])
    .map((pin) => `${pin.id}:${pin.message_id}:${pin.unpinned_at ?? "active"}`)
    .join(",");
  return `${messagePart}#${typingPart}#${pinPart}`;
}

/** A non-empty `signals` delta means something moved since the caller's cursor. */
export function teamSignalsIndicateChange(signals: unknown[] | null | undefined): boolean {
  return Boolean(signals && signals.length > 0);
}

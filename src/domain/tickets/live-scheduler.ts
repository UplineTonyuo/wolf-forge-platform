import { applyTeamJitter, teamBackoffIntervalMs } from "../team/live-scheduler";

/**
 * Pure scheduling policy for the Ticket conversation live lane.
 *
 * Adapted from the proven Team V2.5 design (`src/domain/team/live-scheduler.ts`)
 * rather than copied: the *principles* transfer, the shape does not.
 *
 * What is deliberately NOT carried over from Team:
 *
 * - **No closed lane.** `TeamMessagesDrawer` mounts for a whole session on
 *   every page, so Team needs a cheap "drawer closed" cadence running all day.
 *   A Ticket conversation only exists while a specific Ticket route is
 *   mounted, so there is no closed state to price. Unmount is the only exit,
 *   and it schedules nothing.
 * - **No background lane.** Team's second lane carries the conversation list,
 *   roster, task lists and digest materialization — none of which a single
 *   Ticket route renders.
 * - **No typing or pins.** Neither exists on a Ticket, so neither is in the
 *   fingerprint.
 *
 * What IS carried over, unchanged in substance: three activity tiers that
 * decay instead of pinning one interval forever, recursive `setTimeout` with
 * single-flight protection, bounded backoff on failure, small jitter on
 * scheduled ticks, and pausing to *zero timers* — not a longer interval —
 * while the tab is hidden or the browser is offline.
 *
 * Everything here is a pure function of explicit inputs (no `Date.now()`
 * unless the caller passes it) so the policy is testable without fake timers.
 * `src/components/tickets/use-ticket-live-sync.ts` is the only caller that
 * owns real timers, `document.visibilityState` and `navigator.onLine`.
 */

export type TicketLiveTier = "fast" | "warm" | "quiet";

/**
 * Cadence by tier, while a Ticket conversation is open and visible.
 *
 * FAST is the tier a real back-and-forth sits in. It is a tier, not a fixed
 * interval: the scheduler recomputes it from the last activity on every tick,
 * so an exchange sustains it and an untouched conversation leaves it.
 *
 * QUIET is what an open-but-idle conversation costs — four seconds, roughly a
 * quarter of what an unbounded fast poll would spend, and nothing like the
 * per-second loop this design exists to avoid.
 */
export const TICKET_LIVE_FAST_MS = 800;
export const TICKET_LIVE_WARM_MS = 1_600;
export const TICKET_LIVE_QUIET_MS = 4_000;

/**
 * How long the scheduler stays FAST after the last local or detected remote
 * activity, and how much additional quiet time it then spends WARM before
 * dropping to QUIET.
 *
 * Chosen so a multi-second back-and-forth never leaves FAST, while a
 * conversation left open and untouched settles to QUIET within half a minute.
 */
export const TICKET_FAST_HOLD_MS = 6_000;
export const TICKET_WARM_HOLD_MS = 24_000;

/**
 * How many of the most recent messages the change fingerprint covers in full.
 * New activity always appends at the tail; the totals below cover the rest.
 */
const FINGERPRINT_MESSAGE_WINDOW = 50;

export function nextTicketLiveTier(msSinceActivity: number): TicketLiveTier {
  if (msSinceActivity < TICKET_FAST_HOLD_MS) return "fast";
  if (msSinceActivity < TICKET_FAST_HOLD_MS + TICKET_WARM_HOLD_MS) return "warm";
  return "quiet";
}

export function ticketLiveIntervalMs(tier: TicketLiveTier): number {
  switch (tier) {
    case "fast":
      return TICKET_LIVE_FAST_MS;
    case "warm":
      return TICKET_LIVE_WARM_MS;
    case "quiet":
      return TICKET_LIVE_QUIET_MS;
  }
}

/**
 * The delay before the NEXT scheduled (non-immediate) tick. Backoff only ever
 * lengthens the wait relative to the tier baseline, never shortens it.
 */
export function computeTicketLiveDelayMs(params: {
  tier: TicketLiveTier;
  failureCount: number;
  random?: () => number;
}): number {
  const base = ticketLiveIntervalMs(params.tier);
  const backoff = teamBackoffIntervalMs(params.failureCount);
  return applyTeamJitter(Math.max(base, backoff), params.random);
}

/**
 * Just the fields the fingerprint reads, so this module never has to import
 * the full `TicketDetailMessage` graph.
 */
export type FingerprintableTicketMessage = {
  id: string;
  message_kind?: string;
  reply_to_message_id?: string | null;
  reply_to_attachment_id?: string | null;
  unsent_at?: string | null;
  attachments?: Array<{ id: string }>;
  reactions?: Array<{ reaction_code: string; reaction_count: number }>;
};

/**
 * A cheap structural signature of "what a viewer would notice changed" in this
 * conversation. Two snapshots with an equal fingerprint are indistinguishable
 * on screen; an unequal one is a real remote change and a reason to stay FAST.
 *
 * It has to catch a **reaction-only** change and a **reply relationship**
 * change, not just new messages, so each entry carries:
 *
 * - `id` — a new message always changes the fingerprint;
 * - `reply_to_message_id` / `reply_to_attachment_id` — a reply-target change
 *   is visible even though the replying message's own id is unchanged;
 * - attachment ids — an image arriving on an existing message;
 * - reaction `code:count` pairs — the reaction case, in full;
 * - `unsent_at` and `message_kind`, so a staff-visible tombstone is noticed.
 *
 * `messages.length` and the conversation-wide reaction total sit outside the
 * tail window, so a reaction landing on an older message still moves the
 * fingerprint even though that message is no longer fingerprinted in full.
 *
 * Transcripts are append-only, so ids only ever grow — which is what lets the
 * caller treat a payload missing a known id as a stale read rather than a
 * deletion.
 */
export function ticketConversationFingerprint(
  messages: FingerprintableTicketMessage[],
): string {
  const tail = messages.slice(-FINGERPRINT_MESSAGE_WINDOW);

  let reactionTotal = 0;
  for (const message of messages) {
    for (const reaction of message.reactions ?? []) reactionTotal += reaction.reaction_count;
  }

  const tailPart = tail
    .map((message) =>
      [
        message.id,
        message.message_kind ?? "",
        message.reply_to_message_id ?? "",
        message.reply_to_attachment_id ?? "",
        message.unsent_at ?? "",
        (message.attachments ?? []).map((attachment) => attachment.id).join("+"),
        (message.reactions ?? [])
          .map((reaction) => `${reaction.reaction_code}:${reaction.reaction_count}`)
          .join(","),
      ].join("~"),
    )
    .join("|");

  return `${messages.length}#${reactionTotal}#${tailPart}`;
}

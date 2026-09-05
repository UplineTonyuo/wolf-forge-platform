import { describe, expect, it } from "vitest";
import {
  TEAM_BACKGROUND_CLOSED_MS,
  TEAM_BACKGROUND_OPEN_MS,
  TEAM_BACKGROUND_QUIET_MS,
  TEAM_BACKOFF_STEPS_MS,
  TEAM_FAST_HOLD_MS,
  TEAM_LIVE_CLOSED_MS,
  TEAM_LIVE_FAST_MS,
  TEAM_LIVE_QUIET_MS,
  TEAM_LIVE_WARM_MS,
  TEAM_WARM_HOLD_MS,
  applyTeamJitter,
  computeTeamBackgroundDelayMs,
  computeTeamLiveDelayMs,
  nextTeamLiveTier,
  teamBackgroundIntervalMs,
  teamBackoffIntervalMs,
  teamDetailFingerprint,
  teamLiveIntervalMs,
  teamSignalsIndicateChange,
} from "../domain/team/live-scheduler";

/**
 * Pure scheduling policy, verified without a DOM or a timer: every function
 * here takes its "current time" as an explicit input, so a fake-timer harness
 * would only add noise. Hook-level behavior (actual setTimeout scheduling,
 * hidden/offline pausing, no-overlap, unmount cleanup) lives in
 * `use-team-sync-controller.test.tsx`.
 */
describe("Live tier decay", () => {
  it("1. starts FAST the instant something happened", () => {
    expect(nextTeamLiveTier(0)).toBe("fast");
  });

  it("stays FAST for the whole fast-hold window", () => {
    expect(nextTeamLiveTier(TEAM_FAST_HOLD_MS - 1)).toBe("fast");
  });

  it("2. drops to WARM once the fast-hold window elapses", () => {
    expect(nextTeamLiveTier(TEAM_FAST_HOLD_MS)).toBe("warm");
    expect(nextTeamLiveTier(TEAM_FAST_HOLD_MS + TEAM_WARM_HOLD_MS - 1)).toBe("warm");
  });

  it("3. settles to QUIET after the combined hold window elapses", () => {
    expect(nextTeamLiveTier(TEAM_FAST_HOLD_MS + TEAM_WARM_HOLD_MS)).toBe("quiet");
    expect(nextTeamLiveTier(TEAM_FAST_HOLD_MS + TEAM_WARM_HOLD_MS + 999_999)).toBe("quiet");
  });

  it("4. activity resets the clock, which is exactly tier(0) again", () => {
    // The hook models "activity resets to FAST" by zeroing its idle clock;
    // at the domain layer that is just re-evaluating tier at msSinceActivity=0.
    expect(nextTeamLiveTier(0)).toBe("fast");
  });
});

describe("Tier -> interval mapping", () => {
  it("maps each tier to its documented live interval", () => {
    expect(teamLiveIntervalMs("fast")).toBe(TEAM_LIVE_FAST_MS);
    expect(teamLiveIntervalMs("warm")).toBe(TEAM_LIVE_WARM_MS);
    expect(teamLiveIntervalMs("quiet")).toBe(TEAM_LIVE_QUIET_MS);
    expect(TEAM_LIVE_QUIET_MS).toBeLessThanOrEqual(2_000);
  });

  it("keeps background cadence no faster than justified once quiet", () => {
    expect(teamBackgroundIntervalMs("fast")).toBe(TEAM_BACKGROUND_OPEN_MS);
    expect(teamBackgroundIntervalMs("warm")).toBe(TEAM_BACKGROUND_OPEN_MS);
    expect(teamBackgroundIntervalMs("quiet")).toBe(TEAM_BACKGROUND_QUIET_MS);
    expect(TEAM_BACKGROUND_QUIET_MS).toBeGreaterThan(TEAM_BACKGROUND_OPEN_MS);
  });
});

describe("5. Remote-change detection", () => {
  it("a non-empty signals delta counts as a meaningful remote change", () => {
    expect(teamSignalsIndicateChange([{ conversation_id: "a" }])).toBe(true);
    expect(teamSignalsIndicateChange([])).toBe(false);
    expect(teamSignalsIndicateChange(null)).toBe(false);
    expect(teamSignalsIndicateChange(undefined)).toBe(false);
  });

  it("fingerprint is stable across two identical detail snapshots", () => {
    const detail = {
      messages: [
        { id: "m1", reactions: [{ reaction_code: "heart", reaction_count: 1 }] },
      ],
      typing: [],
    };
    expect(teamDetailFingerprint(detail)).toBe(teamDetailFingerprint(structuredClone(detail)));
  });

  it("fingerprint changes when a reaction count changes", () => {
    const before = teamDetailFingerprint({
      messages: [{ id: "m1", reactions: [{ reaction_code: "heart", reaction_count: 1 }] }],
    });
    const after = teamDetailFingerprint({
      messages: [{ id: "m1", reactions: [{ reaction_code: "heart", reaction_count: 2 }] }],
    });
    expect(before).not.toBe(after);
  });

  it("fingerprint changes when a message is tombstoned", () => {
    const before = teamDetailFingerprint({ messages: [{ id: "m1" }] });
    const after = teamDetailFingerprint({ messages: [{ id: "m1", deleted_for_everyone: true }] });
    expect(before).not.toBe(after);
  });

  it("fingerprint changes when a new message appends", () => {
    const before = teamDetailFingerprint({ messages: [{ id: "m1" }] });
    const after = teamDetailFingerprint({ messages: [{ id: "m1" }, { id: "m2" }] });
    expect(before).not.toBe(after);
  });

  it("fingerprint changes when typing state changes", () => {
    const before = teamDetailFingerprint({ messages: [{ id: "m1" }], typing: [] });
    const after = teamDetailFingerprint({
      messages: [{ id: "m1" }],
      typing: [{ profile_id: "p1", last_typed_at: "2026-08-27T00:00:00.000Z" }],
    });
    expect(before).not.toBe(after);
  });

  it("fingerprint changes when a pin is added or unpinned", () => {
    const before = teamDetailFingerprint({ messages: [{ id: "m1" }], pins: [] });
    const pinned = teamDetailFingerprint({ messages: [{ id: "m1" }], pins: [{ id: "p1", message_id: "m1", unpinned_at: null }] });
    const unpinned = teamDetailFingerprint({ messages: [{ id: "m1" }], pins: [{ id: "p1", message_id: "m1", unpinned_at: "2026-09-01T00:00:00.000Z" }] });
    expect(before).not.toBe(pinned);
    expect(pinned).not.toBe(unpinned);
  });

  it("fingerprint changes when a voice recording expires", () => {
    const before = teamDetailFingerprint({ messages: [{ id: "m1", voice_expired_at: null }] });
    const after = teamDetailFingerprint({ messages: [{ id: "m1", voice_expired_at: "2026-09-01T00:00:00.000Z" }] });
    expect(before).not.toBe(after);
  });

  it("null detail (drawer closed / no conversation) fingerprints to a stable empty value", () => {
    expect(teamDetailFingerprint(null)).toBe("");
  });
});

describe("17 & 19. Bounded backoff (transient failures and auth errors alike)", () => {
  it("no failure streak means no backoff delay", () => {
    expect(teamBackoffIntervalMs(0)).toBe(0);
    expect(teamBackoffIntervalMs(-1)).toBe(0);
  });

  it("escalates through the documented steps", () => {
    expect(teamBackoffIntervalMs(1)).toBe(TEAM_BACKOFF_STEPS_MS[0]);
    expect(teamBackoffIntervalMs(2)).toBe(TEAM_BACKOFF_STEPS_MS[1]);
    expect(teamBackoffIntervalMs(3)).toBe(TEAM_BACKOFF_STEPS_MS[2]);
    expect(teamBackoffIntervalMs(4)).toBe(TEAM_BACKOFF_STEPS_MS[3]);
  });

  it("caps at the final step no matter how long the streak runs — this is what stops a hot loop against a persistently failing or unauthorized endpoint", () => {
    expect(teamBackoffIntervalMs(5)).toBe(TEAM_BACKOFF_STEPS_MS.at(-1));
    expect(teamBackoffIntervalMs(500)).toBe(TEAM_BACKOFF_STEPS_MS.at(-1));
  });
});

describe("18. Successful recovery resets backoff", () => {
  it("failureCount returning to 0 after a success removes the backoff floor", () => {
    const duringFailure = computeTeamLiveDelayMs({ open: true, tier: "fast", failureCount: 3, random: () => 0.5 });
    const afterRecovery = computeTeamLiveDelayMs({ open: true, tier: "fast", failureCount: 0, random: () => 0.5 });
    expect(duringFailure).toBeGreaterThan(afterRecovery);
    expect(afterRecovery).toBe(TEAM_LIVE_FAST_MS);
  });
});

describe("20. Jitter stays in the documented bounds", () => {
  it("never exceeds +/-8% of the base delay", () => {
    const base = 1_000;
    const min = applyTeamJitter(base, () => 0);
    const max = applyTeamJitter(base, () => 1);
    expect(min).toBeGreaterThanOrEqual(Math.round(base * 0.92));
    expect(max).toBeLessThanOrEqual(Math.round(base * 1.08));
  });

  it("is centered on the base delay with a mid-range random draw", () => {
    expect(applyTeamJitter(1_000, () => 0.5)).toBe(1_000);
  });

  it("never goes negative for a zero base", () => {
    expect(applyTeamJitter(0, () => 1)).toBe(0);
  });

  it("defaults to Math.random when no source is supplied, and stays in range across many draws", () => {
    for (let i = 0; i < 50; i += 1) {
      const value = applyTeamJitter(1_000);
      expect(value).toBeGreaterThanOrEqual(910);
      expect(value).toBeLessThanOrEqual(1_090);
    }
  });
});

describe("Combined delay computation", () => {
  it("open + fast, no failures, no jitter draw variance: exactly the fast interval", () => {
    expect(computeTeamLiveDelayMs({ open: true, tier: "fast", failureCount: 0, random: () => 0.5 })).toBe(
      TEAM_LIVE_FAST_MS,
    );
  });

  it("11 & 12. closed uses the closed interval regardless of tier, never the open tier's cadence", () => {
    expect(computeTeamLiveDelayMs({ open: false, tier: "fast", failureCount: 0, random: () => 0.5 })).toBe(
      TEAM_LIVE_CLOSED_MS,
    );
    expect(computeTeamBackgroundDelayMs({ open: false, tier: "fast", failureCount: 0, random: () => 0.5 })).toBe(
      TEAM_BACKGROUND_CLOSED_MS,
    );
  });

  it("backoff overrides a faster tier interval but never makes it faster", () => {
    const delay = computeTeamLiveDelayMs({ open: true, tier: "fast", failureCount: 1, random: () => 0.5 });
    expect(delay).toBe(TEAM_BACKOFF_STEPS_MS[0]);
    expect(delay).toBeGreaterThan(TEAM_LIVE_FAST_MS);
  });

  it("backoff never overrides an already-slower closed interval with a faster one", () => {
    const delay = computeTeamLiveDelayMs({ open: false, tier: "fast", failureCount: 1, random: () => 0.5 });
    expect(delay).toBe(TEAM_LIVE_CLOSED_MS);
  });
});

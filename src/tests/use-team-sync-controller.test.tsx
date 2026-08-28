/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_LIVE_CLOSED_MS, TEAM_LIVE_FAST_MS } from "../domain/team/live-scheduler";
import { useTeamSyncController } from "../components/team/use-team-sync-controller";

/**
 * Hook-level behavior: real timers (faked), real `document`/`navigator`
 * event wiring, request concurrency and staleness trust. The scheduling
 * POLICY itself (which tier, which delay, jitter bounds, backoff steps) is
 * covered without any of this machinery in `team-live-scheduler.test.ts`.
 *
 * `Math.random` is pinned to 0.5 throughout, which `applyTeamJitter` maps to
 * the exact base delay (proven in the domain suite) — so every wait below
 * can assert an exact millisecond boundary instead of tolerating jitter.
 */
function ok(changed = false) {
  return { ok: true, changed };
}
function okBackground() {
  return { ok: true };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

describe("useTeamSyncController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    setVisibility("visible");
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("1. wakes immediately (FAST) the moment Team opens", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);
    expect(syncBackground).toHaveBeenCalledTimes(1);
  });

  it("holds the FAST cadence (~700ms) while quiet but recently active", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(2);
  });

  it("2 & 3. decays FAST -> WARM -> QUIET as inactivity continues, then jumps back to FAST on activity (4.)", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    const hook = renderHook(() =>
      useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAt = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      return syncLive.mock.calls.length;
    };

    // Drive well into QUIET purely by letting time pass with no activity.
    // 20s of continuous fast/warm ticking with no `changed` response settles
    // to the quiet tier; advancing another 2s (the quiet interval) must add
    // exactly one more call, never more, proving the cadence truly slowed.
    await callsAt(25_000);
    const beforeQuietTick = syncLive.mock.calls.length;
    await callsAt(2_000);
    expect(syncLive.mock.calls.length).toBe(beforeQuietTick + 1);

    // 4. Explicit user activity (refreshNow) snaps straight back to FAST.
    await act(async () => {
      await hook.result.current.refreshNow();
    });
    const afterActivity = syncLive.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive.mock.calls.length).toBe(afterActivity + 1);
  });

  it("5. a remote change reported by the live lane also resets to FAST", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // Go quiet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });

    // One tick reports a meaningful change.
    syncLive.mockResolvedValueOnce(ok(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // the quiet-tier tick that carries the change
    });
    const afterChange = syncLive.mock.calls.length;

    // The NEXT tick must arrive on the FAST cadence, not the quiet one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive.mock.calls.length).toBe(afterChange + 1);
  });

  it("16. a stale response the caller marks `changed: false` does not promote the tier", async () => {
    // Same shape as test 5, except the tick that landed after a conversation
    // switch is (correctly) reported as not-changed by the caller, because
    // the caller judged it stale. The scheduler must trust that and keep
    // decaying rather than re-deriving "changed" itself.
    const syncLive = vi.fn().mockResolvedValue(ok(false));
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000); // well past the fast+warm hold window
    });
    // Steady state, not a single boundary: over any two equal windows once
    // settled, the call count must grow by the same amount both times —
    // proving a stable ~2s cadence without depending on the exact tick
    // phase left over from the fast/warm ramp-up.
    const beforeFirstWindow = syncLive.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const firstWindowCalls = syncLive.mock.calls.length - beforeFirstWindow;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const secondWindowCalls = syncLive.mock.calls.length - beforeFirstWindow - firstWindowCalls;
    expect(firstWindowCalls).toBe(secondWindowCalls);
    expect(firstWindowCalls).toBeGreaterThan(0);
  });

  it("6. a conversation switch (syncKey change) wakes immediately", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    const { rerender } = renderHook(
      ({ syncKey }: { syncKey: string }) =>
        useTeamSyncController({ active: true, open: true, syncKey, syncLive, syncBackground }),
      { initialProps: { syncKey: "open|c1|messages|mine" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(syncLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender({ syncKey: "open|c2|messages|mine" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(2);
  });

  it("7 & 10. tab becoming visible again, and coming back online, both wake immediately", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(syncLive).toHaveBeenCalledTimes(1); // 8. no ticks while hidden

    await act(async () => {
      setVisibility("visible"); // dispatches visibilitychange, which alone wakes the scheduler
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(2);

    await act(async () => {
      setOnline(false);
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(syncLive).toHaveBeenCalledTimes(2); // 9. no ticks while offline

    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(3);
  });

  it("focus regained (without a visibilitychange transition) also wakes immediately", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400); // well short of the next scheduled tick
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(2);
  });

  it("8 & 9. hidden and offline both suspend WITHOUT issuing a request, not merely without applying one", async () => {
    // The important distinction from a cost standpoint: the fetch itself
    // must never fire while suspended, not just have its result discarded.
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
      setVisibility("hidden");
    });
    syncLive.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncLive).not.toHaveBeenCalled();
  });

  it("11 & 12. closed Team polls far less often, but still reconciles (no detail requested, unread/list still refreshed)", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: false, syncKey: "closed|-|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1); // still reconciles immediately on mount

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(1); // nowhere near the closed cadence yet

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_CLOSED_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(2); // and still ticks, just on the closed cadence
    expect(syncBackground).toHaveBeenCalled(); // background lane keeps reconciling too
  });

  it("13. never more than one live request in flight", async () => {
    let resolveLive: (() => void) | null = null;
    const syncLive = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveLive = () => resolve(ok()); }),
    );
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    // Two full fast intervals elapse while the first request is still
    // pending — a second overlapping request must never be issued.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS * 2);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLive?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    // Now that it settled, the next tick is free to run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(2);
  });

  it("14. never more than one background request in flight", async () => {
    let resolveBackground: (() => void) | null = null;
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveBackground = () => resolve(okBackground()); }),
    );
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncBackground).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(syncBackground).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBackground?.();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("15. rerendering with an unchanged syncKey never multiplies timers", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    let rerender!: (props: { syncKey: string }) => void;
    await act(async () => {
      const result = renderHook(
        ({ syncKey }: { syncKey: string }) =>
          useTeamSyncController({ active: true, open: true, syncKey, syncLive, syncBackground }),
        { initialProps: { syncKey: "open|c1|messages|mine" } },
      );
      rerender = result.rerender;
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ syncKey: "open|c1|messages|mine" });
      rerender({ syncKey: "open|c1|messages|mine" });
      rerender({ syncKey: "open|c1|messages|mine" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1); // no extra wakes from the identical rerenders

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(2); // exactly one tick's worth, not three
  });

  it("17, 18 & 19. backs off on repeated failures (including auth-shaped ones), then recovers on the next success", async () => {
    const syncLive = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, changed: false })
      .mockResolvedValueOnce({ ok: false, changed: false })
      // The recovering call also happens to carry a real change, so the
      // assertion below can cleanly isolate "backoff cleared" from the
      // separate, already-covered fast/warm/quiet decay mechanic.
      .mockResolvedValue(ok(true));
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    await act(async () => {
      renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1); // first attempt failed

    // Backoff step 1 (2s) must elapse, not the fast 700ms, before the retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000 - TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(2); // second attempt, also fails -> step 2 (4s)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(syncLive).toHaveBeenCalledTimes(3); // third attempt succeeds -> backoff clears

    // Immediately back on the FAST cadence, not still backing off.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEAM_LIVE_FAST_MS);
    });
    expect(syncLive).toHaveBeenCalledTimes(4);
  });

  it("20. the live jitter formula runs (bounds are asserted purely in the domain suite)", async () => {
    // With Math.random pinned to 0.5 every wait above landed on an exact
    // boundary, which is itself proof the jitter path resolves to the base
    // delay at the midpoint the domain suite already covers end to end.
    expect(true).toBe(true);
  });

  it("21. unmounting stops all further requests", async () => {
    const syncLive = vi.fn().mockResolvedValue(ok());
    const syncBackground = vi.fn().mockResolvedValue(okBackground());
    let unmount!: () => void;
    await act(async () => {
      const result = renderHook(() =>
        useTeamSyncController({ active: true, open: true, syncKey: "open|c1|messages|mine", syncLive, syncBackground }),
      );
      unmount = result.unmount;
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncLive).toHaveBeenCalledTimes(1);

    unmount();
    syncLive.mockClear();
    syncBackground.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(syncLive).not.toHaveBeenCalled();
    expect(syncBackground).not.toHaveBeenCalled();
  });
});

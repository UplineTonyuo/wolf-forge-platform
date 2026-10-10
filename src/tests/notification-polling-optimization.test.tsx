/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEAM_LIVE_CLOSED_MS,
  TEAM_LIVE_FAST_MS,
} from "../domain/team/live-scheduler";
import { useTeamSyncController } from "../components/team/use-team-sync-controller";

const root = resolve(import.meta.dirname, "..");
/* Normalized: several of these sources are CRLF on disk. */
const read = (path: string) =>
  readFileSync(resolve(root, path), "utf8").replaceAll(String.fromCharCode(13), "");

/*
 * These drive the real scheduler on fake timers. The jitter is +/-8%, so the
 * windows below are chosen to sit clear of both bounds rather than to land
 * exactly on an interval: TEAM_LIVE_CLOSED_MS lands between 13.8s and 16.2s,
 * and the OPEN tiers are 0.7s / 1.2s / 2s, an order of magnitude apart.
 */
function harness(open: boolean, syncKey: string) {
  const live = vi.fn(async () => ({ ok: true, changed: false }));
  const background = vi.fn(async () => ({ ok: true }));
  const view = renderHook(
    ({ open: isOpen, syncKey: key }) =>
      useTeamSyncController({
        active: true,
        open: isOpen,
        syncKey: key,
        syncLive: live,
        syncBackground: background,
      }),
    { initialProps: { open, syncKey } },
  );
  return { live, background, view };
}

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Team sync scheduler: the CLOSED/OPEN axis", () => {
  it("keeps the lane at the CLOSED cadence, not the open one", async () => {
    const { live } = harness(false, "closed|-|tickets");

    await flush(0);
    expect(live).toHaveBeenCalledTimes(1);

    // Well inside the open cadence, far outside the closed one.
    await flush(4_000);
    expect(live).toHaveBeenCalledTimes(1);

    await flush(TEAM_LIVE_CLOSED_MS);
    expect(live).toHaveBeenCalledTimes(2);
  });

  it("runs the aggressive cadence when a Team conversation is the visible surface", async () => {
    const { live } = harness(true, "open|-|messages");

    await flush(0);
    expect(live).toHaveBeenCalledTimes(1);

    await flush(4_000);
    // FAST is 700ms; even one full tier decay (QUIET, 2s) leaves several.
    expect(live.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(TEAM_LIVE_FAST_MS).toBeLessThan(TEAM_LIVE_CLOSED_MS);
  });

  it("wakes at once when the pane changes back to Messages, then resumes the open cadence", async () => {
    const { live, view } = harness(false, "closed|-|tickets");
    await flush(0);
    expect(live).toHaveBeenCalledTimes(1);

    await flush(4_000);
    expect(live).toHaveBeenCalledTimes(1);

    view.rerender({ open: true, syncKey: "open|-|messages" });
    await flush(0);
    // The pane change itself reconciles immediately, without waiting a tick.
    expect(live).toHaveBeenCalledTimes(2);

    await flush(4_000);
    expect(live.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("does not stack timers when the axis flips repeatedly", async () => {
    const { live, view } = harness(false, "closed|-|tickets");
    await flush(0);

    view.rerender({ open: false, syncKey: "closed|-|tickets|a" });
    view.rerender({ open: false, syncKey: "closed|-|tickets|b" });
    view.rerender({ open: false, syncKey: "closed|-|tickets|c" });
    await flush(0);
    const afterFlips = live.mock.calls.length;
    expect(afterFlips).toBeGreaterThanOrEqual(3); // mount, plus a wake per change

    // One closed interval later exactly one more tick has fired, so the three
    // wakes did not each leave a live timer behind.
    const settled = live.mock.calls.length;
    // One closed interval plus jitter's own ceiling, still short of a second.
    await flush(TEAM_LIVE_CLOSED_MS + 3_000);
    expect(live.mock.calls.length).toBe(settled + 1);
  });
});

describe("Team lane gating is wired at the drawer, not inside the hook", () => {
  it("passes the pane into the CLOSED/OPEN axis", () => {
    const drawer = read("components/team/team-messages-drawer.tsx");
    expect(drawer).toContain("open: open && pane === \"messages\"");
    // The pane is already part of the wake key, so returning to Messages
    // reconciles without any extra plumbing.
    expect(drawer).toContain("const syncKey = `${open ? \"open\" : \"closed\"}|${activeId ?? \"-\"}|${pane}`;");
  });
});

describe("Internal notification chime honours the stored sound preference", () => {
  it("gates the chime on the preference, read at fire time", () => {
    const bar = read("components/shell/workspace-command-bar.tsx");

    // The only chime call sits inside the preference guard.
    expect([...bar.matchAll(/playNotificationChime\(\)/g)]).toHaveLength(1);
    expect(bar).toContain("if (\n                    soundEnabledRef.current && notificationVisibleWithModules(item, ticketsAvailableRef.current, projectsAvailableRef.current)\n                    && (generation === cacheGeneration.current || notificationVisibleWithModules(item, false, true))\n                  ) {\n                    playNotificationChime();");
    expect(bar).toContain("const soundEnabledRef =\n    useRef(\n      notificationSoundEnabled,\n    );");
    expect(bar).toContain("notificationSoundEnabled?: boolean;");
  });

  it("threads the preference from the profile through the layout and shell", () => {
    const layout = read("app/(internal)/layout.tsx");
    expect(layout).toContain("context.services.profile.getMine()");
    expect(layout).toContain("notificationSoundEnabled={profile?.notificationSoundEnabled ?? true}");

    const shell = read("components/shell/internal-shell.tsx");
    expect(shell).toContain("notificationSoundEnabled = true");
    expect(shell).toContain("notificationSoundEnabled={\n            notificationSoundEnabled\n          }");

    // No new preference was invented anywhere in the chain.
    for (const source of [layout, shell, read("components/shell/workspace-command-bar.tsx")]) {
      expect(source).not.toContain("notification_sound_enabled");
    }
  });
});

/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamPresenceProvider } from "../components/team/team-presence-provider";

const HEARTBEAT_INTERVAL_MS = 25_000;

vi.mock("../app/actions/team-messages", () => ({
  touchTeamPresenceAction: vi.fn(async () => ({ ok: true, data: [] })),
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("TeamPresenceProvider visibility handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends a heartbeat on mount and on each interval tick while the tab is visible", async () => {
    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    render(
      <TeamPresenceProvider enabled>
        <p>content</p>
      </TeamPresenceProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(2);
  });

  it("does not send a heartbeat while the tab is hidden, on mount or on interval ticks", async () => {
    setVisibility("hidden");
    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    render(
      <TeamPresenceProvider enabled>
        <p>content</p>
      </TeamPresenceProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(touchTeamPresenceAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    });
    expect(touchTeamPresenceAction).not.toHaveBeenCalled();
  });

  it("sends one immediate heartbeat on hidden -> visible, then resumes the normal cadence", async () => {
    setVisibility("hidden");
    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    render(
      <TeamPresenceProvider enabled>
        <p>content</p>
      </TeamPresenceProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    });
    expect(touchTeamPresenceAction).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(2);
  });

  it("does not accumulate duplicate timers or listeners across repeated visibility changes", async () => {
    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    render(
      <TeamPresenceProvider enabled>
        <p>content</p>
      </TeamPresenceProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        setVisibility("hidden");
        await vi.advanceTimersByTimeAsync(0);
        setVisibility("visible");
        await vi.advanceTimersByTimeAsync(0);
      });
    }

    // One extra call per visible transition above (5), on top of the mount call.
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(6);

    vi.mocked(touchTeamPresenceAction).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    // A single still-running interval ticks once — not once per registered listener.
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(1);
  });

  it("stops heartbeating after unmount", async () => {
    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    const { unmount } = render(
      <TeamPresenceProvider enabled>
        <p>content</p>
      </TeamPresenceProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(touchTeamPresenceAction).toHaveBeenCalledTimes(1);

    unmount();
    vi.mocked(touchTeamPresenceAction).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    });
    expect(touchTeamPresenceAction).not.toHaveBeenCalled();
  });
});

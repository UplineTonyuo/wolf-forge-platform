/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ presence: vi.fn() }));
vi.mock("../app/actions/notifications", () => ({ setClientConversationPresenceAction: mocks.presence }));
const { useClientConversationPresence } = await import("../components/tickets/use-client-conversation-presence");
const ID = "20000000-0000-4000-8000-000000000001";
function Harness() { useClientConversationPresence("project", ID); return null; }
function visibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}
function online(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.presence.mockReset().mockResolvedValue({ ok: true });
  visibility("visible"); online(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("client conversation presence traffic", () => {
  it("sends nothing when initially hidden or offline", async () => {
    visibility("hidden");
    const hidden = render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    hidden.unmount();
    visibility("visible"); online(false);
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.presence).not.toHaveBeenCalled();
  });

  it("sends one false transition on hide and no periodic hidden traffic", async () => {
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => { visibility("hidden"); await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { visibility("hidden"); window.dispatchEvent(new Event("focus")); });
    expect(mocks.presence.mock.calls).toEqual([["project", ID, true], ["project", ID, false]]);
    await act(async () => visibility("visible"));
    expect(mocks.presence).toHaveBeenLastCalledWith("project", ID, true);
    expect(mocks.presence).toHaveBeenCalledTimes(3);
  });

  it("skips offline heartbeats and resumes once online", async () => {
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => { online(false); await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.presence).toHaveBeenCalledOnce();
    await act(async () => online(true));
    expect(mocks.presence).toHaveBeenCalledTimes(2);
  });

  it("coalesces heartbeats and transitions while a request is pending", async () => {
    let finish!: () => void;
    mocks.presence.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.presence).toHaveBeenCalledOnce();
    await act(async () => { visibility("hidden"); visibility("hidden"); finish(); });
    expect(mocks.presence.mock.calls).toEqual([["project", ID, true], ["project", ID, false]]);
  });

  it("serializes cleanup after a pending active request and clears timers/listeners", async () => {
    let finish!: () => void;
    mocks.presence.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<Harness />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.presence).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(mocks.presence.mock.calls).toEqual([["project", ID, true], ["project", ID, false]]);
    await act(async () => { online(true); visibility("visible"); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.presence).toHaveBeenCalledTimes(2);
  });

  it("does not try a network cleanup when offline", async () => {
    const view = render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    online(false);
    view.unmount();
    expect(mocks.presence).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains a failed best-effort heartbeat without a retry loop", async () => {
    mocks.presence.mockRejectedValue(new Error("offline transport"));
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.presence).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(14_000));
    expect(mocks.presence).toHaveBeenCalledTimes(2);
  });
});

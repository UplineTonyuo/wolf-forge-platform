/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPresence = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../app/actions/notifications", () => ({
  setClientConversationPresenceAction: setPresence,
}));

const { useClientConversationPresence } = await import(
  "../components/tickets/use-client-conversation-presence"
);

function Harness() {
  useClientConversationPresence("project", "70000000-0000-4000-8000-000000000010");
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  setPresence.mockClear();
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("client conversation presence", () => {
  it("marks the exact visible conversation active, inactive when hidden, and clears on leave", () => {
    const view = render(<Harness />);
    expect(setPresence).toHaveBeenLastCalledWith(
      "project", "70000000-0000-4000-8000-000000000010", true,
    );

    act(() => setVisibility("hidden"));
    expect(setPresence).toHaveBeenLastCalledWith(
      "project", "70000000-0000-4000-8000-000000000010", false,
    );

    act(() => setVisibility("visible"));
    expect(setPresence).toHaveBeenLastCalledWith(
      "project", "70000000-0000-4000-8000-000000000010", true,
    );

    view.unmount();
    expect(setPresence).toHaveBeenLastCalledWith(
      "project", "70000000-0000-4000-8000-000000000010", false,
    );
  });
});

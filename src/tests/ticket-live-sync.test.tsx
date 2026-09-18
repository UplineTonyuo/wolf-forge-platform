/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../app/actions/tickets", () => ({
  sendTicketComposerAction: vi.fn(async () => ({ ok: true })),
  toggleTicketMessageReactionAction: vi.fn(async () => ({ ok: true })),
  toggleClientTicketMessageReactionAction: vi.fn(async () => ({ ok: true })),
  forwardTicketMessageToTeamAction: vi.fn(async () => ({ ok: true })),
}));

const { useTicketLiveSync } = await import("../components/tickets/use-ticket-live-sync");
const { useTicketConversationMessages } = await import(
  "../components/tickets/use-ticket-conversation-messages"
);

import type { TicketDetailMessage } from "../domain/tickets/schema";

const TICKET_ID = "70000000-0000-4000-8000-000000000010";
const OTHER_TICKET_ID = "70000000-0000-4000-8000-0000000000ff";

function message(id: string, overrides: Partial<TicketDetailMessage> = {}): TicketDetailMessage {
  return {
    id,
    ticket_id: TICKET_ID,
    author_profile_id: "70000000-0000-4000-8000-000000000020",
    author_name: "Client Person",
    author_avatar_url: null,
    author_type: "client",
    message_kind: "reply",
    visibility: "client",
    body: `body ${id}`,
    created_at: "2026-09-17T10:00:00Z",
    attachments: [],
    reactions: [],
    ...overrides,
  } as TicketDetailMessage;
}

const fetchMock = vi.fn();

function respond(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function LiveHarness({ onMessages }: { onMessages: (messages: unknown[], fingerprint: string) => boolean }) {
  const { wake } = useTicketLiveSync({
    ticketId: TICKET_ID,
    active: true,
    getFingerprint: () => "current-fingerprint",
    onMessages,
  });
  return <button onClick={wake}>wake</button>;
}

function ConversationHarness({ serverMessages }: { serverMessages: TicketDetailMessage[] }) {
  const conversation = useTicketConversationMessages({
    ticketId: TICKET_ID,
    serverMessages,
    mode: "client",
  });
  return (
    <ul>
      {conversation.messages.map((entry) => (
        <li key={entry.id}>{entry.id}</li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    respond({ ok: true, data: { ticketId: TICKET_ID, fingerprint: "f", changed: false, messages: null } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  setVisibility("visible");
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Ticket live lane scheduling", () => {
  it("reconciles once on mount and then only on its own cadence", async () => {
    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    /* Five seconds of tier-time is a handful of adaptive ticks, not 5 x 1s of
       a fixed loop. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(12);
  });

  it("settles an idle open conversation onto the quiet cadence", async () => {
    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    /* Idle the conversation out of FAST and WARM first. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    const beforeIdleWindow = fetchMock.mock.calls.length;

    /* Twenty seconds of an open but untouched conversation. At the fast tier
       that window would cost ~25 requests; the quiet cadence costs a handful. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    const idleCalls = fetchMock.mock.calls.length - beforeIdleWindow;
    expect(idleCalls).toBeLessThanOrEqual(8);
    expect(idleCalls).toBeGreaterThan(2);
  });

  it("promotes back to the fast cadence when remote activity is detected", async () => {
    const onMessages = vi.fn(() => true);
    render(<LiveHarness onMessages={onMessages} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    /* Idle out to the quiet cadence first. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    const idleCalls = fetchMock.mock.calls.length;

    /* Now the other side acts: every answer carries a change. */
    fetchMock.mockImplementation(() =>
      respond({
        ok: true,
        data: { ticketId: TICKET_ID, fingerprint: "moved", changed: true, messages: [] },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    /* A quiet conversation ticks about five times in 20s; a promoted one ticks
       far more often. */
    expect(fetchMock.mock.calls.length - idleCalls).toBeGreaterThan(12);
  });

  it("schedules NOTHING while the tab is hidden", async () => {
    setVisibility("hidden");
    render(<LiveHarness onMessages={() => false} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("schedules NOTHING while the browser is offline", async () => {
    setOnline(false);
    render(<LiveHarness onMessages={() => false} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resumes and reconciles immediately when the tab becomes visible again", async () => {
    setVisibility("hidden");
    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled tick when the tab goes hidden mid-flight", async () => {
    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterMount = fetchMock.mock.calls.length;

    await act(async () => {
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock.mock.calls.length).toBe(afterMount);
  });

  it("stops every request after unmount", async () => {
    const view = render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterMount = fetchMock.mock.calls.length;

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock.mock.calls.length).toBe(afterMount);
  });

  it("never overlaps two requests for the same conversation", async () => {
    let resolveFirst: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    /* Nothing may be fired while the first request is still outstanding. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.(
        { ok: true, json: async () => ({ ok: true, data: { changed: false, messages: null } }) } as Response,
      );
    });

    /*
     * Finishing the request arms the NEXT one rather than firing immediately,
     * and by now the conversation has been idle for the whole 30s, so that
     * tick is scheduled on the QUIET cadence — which is itself the adaptive
     * behavior under test. Five seconds clears it.
     */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("discards a response for a different Ticket", async () => {
    const onMessages = vi.fn(() => true);
    fetchMock.mockImplementation(() =>
      respond({ ok: true, data: { ticketId: OTHER_TICKET_ID, fingerprint: "f", changed: true, messages: [message("x")] } }),
    );

    render(<LiveHarness onMessages={onMessages} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onMessages).not.toHaveBeenCalled();
  });

  it("does not touch the transcript when nothing changed", async () => {
    const onMessages = vi.fn(() => true);
    render(<LiveHarness onMessages={onMessages} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(onMessages).not.toHaveBeenCalled();
  });

  it("sends the fingerprint it already holds, and never an actor identity", async () => {
    render(<LiveHarness onMessages={() => false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ ticket_id: TICKET_ID, fingerprint: "current-fingerprint" });
    expect(body).not.toHaveProperty("actorId");
    expect(body).not.toHaveProperty("companyId");
    expect(body).not.toHaveProperty("role");
  });
});

describe("Ticket transcript assembly", () => {
  it("adopts a remote message without a reload", async () => {
    const serverMessages = [message("m1")];
    render(<ConversationHarness serverMessages={serverMessages} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    fetchMock.mockImplementation(() =>
      respond({
        ok: true,
        data: {
          ticketId: TICKET_ID,
          fingerprint: "changed",
          changed: true,
          messages: [message("m1"), message("m2")],
        },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never duplicates a message that arrived by both the server render and the live lane", async () => {
    const serverMessages = [message("m1"), message("m2")];
    render(<ConversationHarness serverMessages={serverMessages} />);

    fetchMock.mockImplementation(() =>
      respond({
        ok: true,
        data: {
          ticketId: TICKET_ID,
          fingerprint: "same-content",
          changed: true,
          messages: [message("m1"), message("m2")],
        },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    /* Replaced, never appended: two canonical copies stay two rows. */
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("ignores a stale payload that is missing a message already on screen", async () => {
    const serverMessages = [message("m1"), message("m2")];
    render(<ConversationHarness serverMessages={serverMessages} />);

    /* A read that began before m2 committed would come back without it. */
    fetchMock.mockImplementation(() =>
      respond({
        ok: true,
        data: { ticketId: TICKET_ID, fingerprint: "stale", changed: true, messages: [message("m1")] },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

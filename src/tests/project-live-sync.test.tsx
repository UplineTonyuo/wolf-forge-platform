/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketDetailMessage } from "../domain/tickets/schema";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/actions/tickets", () => ({
  sendTicketComposerAction: vi.fn(async () => ({ ok: true })),
  toggleClientOrderMessageReactionAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../components/tickets/use-client-conversation-presence", () => ({ useClientConversationPresence: vi.fn() }));
vi.mock("../components/tickets/ticket-conversation", () => ({
  TicketConversation: ({ messages }: { messages: TicketDetailMessage[] }) => <ul>{messages.map((message) => <li key={message.id}>{message.body}</li>)}</ul>,
}));
vi.mock("../components/tickets/ticket-composer", () => ({
  TicketComposer: function Composer() {
    const [text, setText] = useState("");
    const [name, setName] = useState("");
    return <div><input aria-label="Draft text" value={text} onChange={(event) => setText(event.target.value)} />
      <input aria-label="Draft file" type="file" onChange={(event) => setName(event.target.files?.[0]?.name ?? "")} /><span>{name}</span></div>;
  },
}));
const { ProjectConversation } = await import("../components/tickets/project-conversation");
const { useTicketLiveSync } = await import("../components/tickets/use-ticket-live-sync");
const PROJECT = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const initial = [{ id: "one", ticket_id: PROJECT, body: "Existing synthetic message", created_at:"2026-11-10T00:00:00Z", author_type:"client", author_profile_id:"client",author_name:"Synthetic Client",author_avatar_url:null,message_kind:"reply",visibility:"client",attachments: [], reactions: [] }] as TicketDetailMessage[];

function response(data: unknown, status = 200) {
  return { status, json: async () => status === 200 ? { ok: true, data } : { ok: false, code: "PERMISSION_DENIED" } } as Response;
}
function visibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}
function online(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}
function Harness({ onMessages = () => false }: { onMessages?: (messages: unknown[], fingerprint: string) => boolean }) {
  useTicketLiveSync({ projectId: PROJECT, active: true, getFingerprint: () => "current", onMessages });
  return null;
}
function stalledFetch(_url: string, options: RequestInit) {
  return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(response({ orderId: PROJECT, changed: false, messages: null, fingerprint: "current" }));
  visibility("visible");
  online(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Project shared live synchronization", () => {
  it("sends an exclusive Project target rather than a Ticket or actor identity", async () => {
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toEqual({ order_id: PROJECT, fingerprint: "current" });
  });

  it.each([
    { ticketId: PROJECT }, { orderId: OTHER }, { orderId: PROJECT, ticketId: PROJECT },
  ])("discards responses for the wrong resource or mixed identifier kind", async (identifiers) => {
    const onMessages = vi.fn(() => true);
    mocks.fetch.mockResolvedValue(response({ ...identifiers, changed: true, messages: initial, fingerprint: "changed" }));
    render(<Harness onMessages={onMessages} />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(onMessages).not.toHaveBeenCalled();
  });

  it("preserves mounted composer text and file state through remote messages and ordinary refresh", async () => {
    const view = render(<ProjectConversation orderId={PROJECT} heading="Synthetic Project" messages={initial} viewerProfileId="client" repliesDisabled={false} />);
    fireEvent.change(screen.getByLabelText("Draft text"), { target: { value: "Unsent synthetic draft" } });
    fireEvent.change(screen.getByLabelText("Draft file"), { target: { files: [new File(["%PDF"], "synthetic.pdf", { type: "application/pdf" })] } });
    mocks.fetch.mockResolvedValue(response({ orderId: PROJECT, changed: true, fingerprint: "changed", messages: [...initial, { ...initial[0], id: "two", body: "Remote synthetic reply" }] }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText("Remote synthetic reply")).toBeInTheDocument();
    view.rerender(<ProjectConversation orderId={PROJECT} heading="Synthetic Project" messages={[...initial]} viewerProfileId="client" repliesDisabled={false} />);
    expect(screen.getByLabelText("Draft text")).toHaveValue("Unsent synthetic draft");
    expect(screen.getByText("synthetic.pdf")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("redacts the transcript and composer after authoritative access refusal", async () => {
    mocks.fetch.mockResolvedValue(response(null, 403));
    render(<ProjectConversation orderId={PROJECT} heading="Synthetic Project" messages={initial} viewerProfileId="client" repliesDisabled={false} />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.queryByText("Existing synthetic message")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Draft text")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const count = mocks.fetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.fetch).toHaveBeenCalledTimes(count);
  });

  it("aborts an active request offline, schedules nothing, and wakes once after reconnecting", async () => {
    mocks.fetch.mockImplementation(stalledFetch);
    const view = render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const signal = mocks.fetch.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { online(false); await vi.advanceTimersByTimeAsync(60_000); });
    expect(signal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    mocks.fetch.mockResolvedValue(response({ orderId: PROJECT, changed: false, messages: null }));
    await act(async () => { online(true); await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled read after 15 seconds and retries with backoff without overlap", async () => {
    mocks.fetch.mockImplementation(stalledFetch);
    const view = render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const signal = mocks.fetch.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a request and clears timers when hidden or unmounted", async () => {
    mocks.fetch.mockImplementation(stalledFetch);
    const view = render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const signal = mocks.fetch.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { visibility("hidden"); await vi.advanceTimersByTimeAsync(60_000); });
    expect(signal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

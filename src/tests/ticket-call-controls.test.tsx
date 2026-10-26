/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketCallControls } from "../components/tickets/ticket-call-controls";

const sdk = vi.hoisted(() => ({ createFrame: vi.fn() }));
vi.mock("@daily-co/daily-js", () => ({ default: sdk }));

const TICKET = "10000000-0000-4000-8000-000000000001";
const OTHER_TICKET = "10000000-0000-4000-8000-000000000002";
const fetchMock = vi.fn();
const events = new Map<string, () => void>();
const frame = { join: vi.fn(), destroy: vi.fn(), on: vi.fn(), iframe: vi.fn() };

function response(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function callDetails(mode: "audio" | "video" = "audio", expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return { ok: true, data: { callId: "10000000-0000-4000-8000-000000000003", roomUrl: "https://wolfforge.daily.co/wf-call-10000000-0000-4000-8000-000000000003", token: "private-test-token", expiresAt, mode } };
}

async function openCall(mode: "audio" | "video" = "audio") {
  fireEvent.click(await screen.findByRole("button", { name: mode === "audio" ? "Voice call" : "Video call" }));
  return screen.getByRole("button", { name: "Join call" });
}

beforeEach(() => {
  vi.clearAllMocks();
  events.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === "POST" ? callDetails() : { ok: true, enabled: true }));
  frame.join.mockResolvedValue(undefined);
  frame.destroy.mockResolvedValue(undefined);
  frame.iframe.mockReturnValue(document.createElement("iframe"));
  frame.on.mockImplementation((event: string, handler: () => void) => { events.set(event, handler); return frame; });
  sdk.createFrame.mockReturnValue(frame);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Daily local pilot controls", () => {
  it("leaves ordinary conversations unchanged when the server does not enable the pilot", async () => {
    fetchMock.mockImplementation(() => response({ ok: true, enabled: false }));
    const { container } = render(<TicketCallControls ticketId={TICKET} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
    expect(sdk.createFrame).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("fails closed and aborts an eligibility request when the conversation changes", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation((url: string) => url.includes(TICKET) ? new Promise((resolve) => { resolveOld = resolve; }) : response({}, 404));
    const { rerender, container } = render(<TicketCallControls ticketId={TICKET} />);
    const signal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal;
    rerender(<TicketCallControls ticketId={OTHER_TICKET} />);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolveOld?.(await response({ ok: true, enabled: true })); });
    expect(container).toBeEmptyDOMElement();
    expect(sdk.createFrame).not.toHaveBeenCalled();
  });

  it("keeps authorized controls disabled when replies are disabled", async () => {
    render(<TicketCallControls ticketId={TICKET} disabled />);
    expect(await screen.findByRole("button", { name: "Voice call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Video call" })).toBeDisabled();
    expect(sdk.createFrame).not.toHaveBeenCalled();
  });

  it("requires an explicit join, sends audio mode, and releases media when ended", async () => {
    render(<TicketCallControls ticketId={TICKET} />);
    const join = await openCall();
    expect(screen.getByRole("dialog", { name: "Voice call" })).toBeInTheDocument();
    expect(screen.getByText("Private conversation call · 15-minute limit")).toBeInTheDocument();
    expect(sdk.createFrame).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(join);
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[1]).toEqual(["/api/ticket-calls", expect.objectContaining({ method: "POST", credentials: "same-origin", body: expect.any(String) })]);
    expect(sdk.createFrame).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ videoSource: false, startVideoOff: true }));
    expect(frame.join).toHaveBeenCalledWith({ url: "https://wolfforge.daily.co/wf-call-10000000-0000-4000-8000-000000000003", token: "private-test-token", videoSource: false, startVideoOff: true });
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(frame.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("joins video only after the selected video call is confirmed", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === "POST" ? callDetails("video") : { ok: true, enabled: true }));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall("video"));
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    expect(frame.join).toHaveBeenCalledWith({ url: "https://wolfforge.daily.co/wf-call-10000000-0000-4000-8000-000000000003", token: "private-test-token" });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({ ticket_id: TICKET, mode: "video" });
  });

  it("does not create or join a frame after a pending join was closed", async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise((resolve) => { resolvePost = resolve; }) : response({ ok: true, enabled: true }));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    const signal = fetchMock.mock.calls[1]?.[1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { resolvePost?.(await response(callDetails())); });
    expect(sdk.createFrame).not.toHaveBeenCalled();
    expect(frame.join).not.toHaveBeenCalled();
  });

  it("destroys a frame on Escape even while the SDK is still joining", async () => {
    let resolveJoin: (() => void) | undefined;
    frame.join.mockImplementation(() => new Promise<void>((resolve) => { resolveJoin = resolve; }));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(frame.destroy).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await act(async () => { resolveJoin?.(); });
    expect(screen.queryByRole("button", { name: "End call" })).not.toBeInTheDocument();
  });

  it("does not dismiss a connecting call from an accidental backdrop click", async () => {
    frame.join.mockImplementation(() => new Promise(() => {}));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByRole("dialog", { name: "Voice call" })).toBeInTheDocument();
    expect(frame.destroy).not.toHaveBeenCalled();
  });

  it("waits for permission after loading without hanging up the shared room on cancel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    frame.join.mockImplementation(() => new Promise(() => {}));
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === "POST" ? callDetails("audio", new Date(Date.now() + 900_000).toISOString()) : { ok: true, enabled: true }));
    render(<TicketCallControls ticketId={TICKET} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Voice call" }));
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));
    await act(async () => {});
    act(() => events.get("loaded")?.());
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(frame.destroy).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("bounds a stalled frame load to 45 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    frame.join.mockImplementation(() => new Promise(() => {}));
    render(<TicketCallControls ticketId={TICKET} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Voice call" }));
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(45_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("The call did not connect.");
    expect(frame.destroy).toHaveBeenCalledOnce();
  });

  it("ends the shared room when a connected participant uses Daily Leave", async () => {
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    act(() => events.get("left-meeting")?.());
    expect(screen.getByRole("status")).toHaveTextContent("Call ended.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it.each([403, 404])("ends a stale or unauthorized %i join without creating a frame", async (status) => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? response({}, status) : response({ ok: true, enabled: true }));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("This call is no longer available."));
    expect(sdk.createFrame).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("releases a failed join and allows retry without displaying provider errors", async () => {
    frame.join.mockRejectedValueOnce(new Error("sensitive provider detail"));
    render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t connect the call.");
    expect(screen.queryByText("sensitive provider detail")).not.toBeInTheDocument();
    expect(frame.destroy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(frame.join).toHaveBeenCalledTimes(2));
  });

  it("ends the session at token expiry instead of leaving media connected", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === "POST" ? callDetails("audio", new Date(Date.now() + 1_000).toISOString()) : { ok: true, enabled: true }));
    render(<TicketCallControls ticketId={TICKET} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Voice call" }));
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));
    await act(async () => {});
    expect(frame.join).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(frame.destroy).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("This call has ended.");
  });

  it("releases media on page exit and does not destroy the same frame twice", async () => {
    const { unmount } = render(<TicketCallControls ticketId={TICKET} />);
    fireEvent.click(await openCall());
    await waitFor(() => expect(frame.join).toHaveBeenCalledOnce());
    fireEvent(window, new Event("beforeunload"));
    expect(frame.destroy).toHaveBeenCalledOnce();
    unmount();
    expect(frame.destroy).toHaveBeenCalledOnce();
  });
});

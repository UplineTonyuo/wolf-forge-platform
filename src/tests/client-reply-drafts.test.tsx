/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studioDraftSavingAvailable } from "../domain/tickets/draft-saving";
import type { ConversationDraft } from "../lib/tickets/client-draft-store";

const storage = vi.hoisted(() => ({ prepare: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
const send = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/tickets", () => ({ sendTicketComposerAction: send }));
vi.mock("../lib/tickets/client-draft-store", () => ({
  prepareDraftSession: storage.prepare, readConversationDraft: storage.read,
  writeConversationDraft: storage.write, deleteConversationDraft: storage.remove, clearDeviceDrafts: storage.clear,
  revokeTicketDrafts: vi.fn().mockResolvedValue(undefined),
}));
import { ClientDraftProvider, ClientDraftSignOut } from "../components/tickets/client-draft-provider";
import { TicketComposer } from "../components/tickets/ticket-composer";

const owner = "company:client";
const ticketId = "20000000-0000-4000-8000-000000000001";
let saved: ConversationDraft | null;
beforeEach(() => {
  vi.clearAllMocks(); saved = null;
  storage.prepare.mockImplementation(async (actor: string) => ({ owner: actor, epoch: "device-session" }));
  storage.read.mockImplementation(async () => saved);
  storage.write.mockImplementation(async (_lease: unknown, _target: string, draft: ConversationDraft) => { saved = draft; });
  storage.remove.mockImplementation(async () => { saved = null; });
  storage.clear.mockResolvedValue(undefined);
  send.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function workspace(confirmedRequestIds: string[] = [], actor: string | null = owner) {
  return render(<ClientDraftProvider owner={actor}>
    <TicketComposer target={{ kind: "ticket", ticketId }} mode="client" attached confirmedRequestIds={confirmedRequestIds} />
  </ClientDraftProvider>);
}
async function ready() { await waitFor(() => expect(screen.getByRole("textbox", { name: "Write a reply" })).not.toHaveAttribute("aria-disabled", "true")); }
function type(text: string) {
  const editor = screen.getByRole("textbox", { name: "Write a reply" });
  editor.textContent = text; fireEvent.input(editor);
}
function attach() {
  const file = new File(["%PDF-1.4 synthetic fixture"], "synthetic.pdf", { type: "application/pdf", lastModified: 123 });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return file;
}
async function savedStatus() { await screen.findByText(/Draft saved on this device for 30 days/); }

describe("private client reply drafts", () => {
  it("is enabled only in a Preview using the isolated Studio backend", () => {
    const env = { VERCEL_ENV: "preview", SUPABASE_URL: "https://rsnmlcyopnxucwgfttyf.supabase.co" };
    expect(studioDraftSavingAvailable(env)).toBe(true);
    expect(studioDraftSavingAvailable({ ...env, VERCEL_ENV: "production" })).toBe(false);
    expect(studioDraftSavingAvailable({ ...env, SUPABASE_URL: "https://jwynqsyirgenqlmkooah.supabase.co" })).toBe(false);
    expect(studioDraftSavingAvailable({})).toBe(false);
  });

  it("does not open draft storage when the feature is off", async () => {
    workspace([], null); type("Normal reply");
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(storage.prepare).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("restores text and the actual selected File after unmount and reopening", async () => {
    const first = workspace(); await ready(); type("Keep my draft after closing");
    const file = attach(); await savedStatus();
    expect(saved?.attachment).toBe(file);
    expect(storage.write.mock.lastCall?.[0]).toEqual({ owner, epoch: "device-session" });
    expect(storage.write.mock.lastCall?.[1]).toBe(`ticket:${ticketId}`);
    first.unmount(); workspace(); await ready();
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toHaveTextContent("Keep my draft after closing");
    expect(screen.getByRole("button", { name: "Remove synthetic.pdf" })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the draft until a send succeeds, then removes it", async () => {
    let finish!: (value: { ok: boolean }) => void;
    send.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    workspace(); await ready(); type("Wait for server confirmation"); attach(); await savedStatus();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(saved?.body).toBe("Wait for server confirmation");
    expect(storage.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove synthetic.pdf" })).toBeInTheDocument();
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(saved).toBeNull());
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Remove synthetic.pdf" })).not.toBeInTheDocument();
  });

  it("does not carry a previous conversation's text into another conversation", async () => {
    const view = workspace(); await ready(); type("First conversation only"); attach(); await savedStatus();
    storage.read.mockResolvedValueOnce(null);
    view.rerender(<ClientDraftProvider owner={owner}>
      <TicketComposer target={{ kind: "ticket", ticketId: "20000000-0000-4000-8000-000000000003" }} mode="client" attached />
    </ClientDraftProvider>);
    await ready();
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Remove synthetic.pdf" })).not.toBeInTheDocument();
    expect(storage.write.mock.lastCall?.[1]).toBe(`ticket:${ticketId}`);
  });

  it("recovers a failed send with the same request ID for safe retry", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "Offline" });
    const first = workspace(); await ready(); type("Recover offline text and PDF"); attach(); await savedStatus();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText("Offline");
    const requestId = send.mock.calls[0]![0].requestId;
    expect(saved?.requestId).toBe(requestId);
    first.unmount(); workspace(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0].requestId).toBe(requestId);
    expect(send.mock.calls[1]![1].get("attachment").name).toBe("synthetic.pdf");
  });

  it("does not restore an already confirmed send after a lost response", async () => {
    const requestId = "20000000-0000-4000-8000-000000000002";
    saved = { body: "Already received", attachment: new File(["pdf"], "synthetic.pdf"), requestId, updatedAt: Date.now(), replyTo: null };
    workspace([requestId]); await ready();
    expect(saved).toBeNull();
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Remove synthetic.pdf" })).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("needs explicit discard confirmation and removes both text and file", async () => {
    workspace(); await ready(); type("Discard only deliberately"); attach(); await savedStatus();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep draft" }));
    expect(saved?.body).toBe("Discard only deliberately");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard unsent draft?" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Discard unsent draft?" })).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(saved).toBeNull());
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Remove synthetic.pdf" })).not.toBeInTheDocument();
  });

  it("shows storage failure and does not pretend the draft is saved", async () => {
    storage.write.mockRejectedValue(new Error("Quota or competing tab"));
    workspace(); await ready(); type("Still visible despite a storage failure");
    await screen.findByText(/Draft not saved/);
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toHaveTextContent("Still visible despite a storage failure");
    const close = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(close); expect(close.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText(/Your draft could not be saved/);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not allow typing over an unfinished restore", async () => {
    storage.read.mockReturnValue(new Promise(() => undefined));
    workspace();
    await screen.findByText("Restoring draft…");
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Add file" })).toBeDisabled();
  });

  it("clears device drafts before calling the normal sign-out action", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<ClientDraftProvider owner={owner}><ClientDraftSignOut action={logout}><button>Sign out test</button></ClientDraftSignOut></ClientDraftProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign out test" }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(storage.clear.mock.invocationCallOrder[0]!).toBeLessThan(logout.mock.invocationCallOrder[0]!);
  });
});

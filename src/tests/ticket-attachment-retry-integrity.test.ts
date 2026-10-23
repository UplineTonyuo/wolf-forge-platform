import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../lib/errors/application-error";

const f = vi.hoisted(() => ({
  prepare: vi.fn(), send: vi.fn(), store: vi.fn(), remove: vi.fn(), context: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: (error: unknown) => {
  if (error instanceof Error && 'digest' in error) throw error;
} }));
vi.mock("../lib/supabase/next-server", () => ({
  getClientContext: async () => ({ actor: { id: "synthetic-client" }, services: { tickets: { prepareAttachment: f.prepare, sendWithAttachment: f.send } } }),
  getInternalContext: f.context,
}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({}) }));
vi.mock("../repositories/ticket-attachment-storage-repository", () => ({
  TicketAttachmentStorageRepository: class {
    checksum() { return "a".repeat(64); }
    storeOrConfirm = f.store;
    remove = f.remove;
  },
}));
const { sendTicketComposerAction, listTicketSummariesAction, getTicketInboxConversationAction } = await import("../app/actions/tickets");

describe("Inbox authentication revocation", () => {
  it("preserves the framework login redirect for an expired session", async () => {
    const redirect = Object.assign(new Error('Redirect'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    f.context.mockRejectedValue(redirect);
    await expect(listTicketSummariesAction()).rejects.toBe(redirect);
    await expect(getTicketInboxConversationAction('synthetic-ticket')).rejects.toBe(redirect);
  });
  it("returns a typed list denial when current internal membership is revoked", async () => {
    f.context.mockRejectedValue(new ApplicationError("PERMISSION_DENIED", "Internal access is denied"));
    await expect(listTicketSummariesAction()).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });
  it("returns a typed detail denial when current internal membership is revoked", async () => {
    f.context.mockRejectedValue(new ApplicationError("PERMISSION_DENIED", "Internal access is denied"));
    await expect(getTicketInboxConversationAction("synthetic-ticket")).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });
});

describe("accepted attachment retry integrity", () => {
  it("never deletes bytes accepted by a concurrent same-ID finalization", async () => {
    let bytesPresent = true;
    let refuseFirst!: () => void;
    let firstReady!: () => void;
    const ready = new Promise<void>((resolve) => { firstReady = resolve; });
    const first = new Promise<void>((_resolve, reject) => { refuseFirst = () => reject(new ApplicationError("PERMISSION_DENIED", "Tickets access is denied")); });
    f.prepare.mockResolvedValue({ storage_key: "synthetic-client/request-id" });
    f.store.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    f.remove.mockImplementation(async () => { bytesPresent = false; });
    f.send.mockImplementationOnce(() => { firstReady(); return first; }).mockResolvedValueOnce(undefined);
    const input = { requestId: "same-request", mode: "client" as const, target: { kind: "ticket" as const, ticketId: "synthetic-ticket" } };
    const form = () => { const data = new FormData(); data.set("body", "Historical attachment"); data.set("attachment", new File(["%PDF-1.7\n"], "history.pdf", { type: "application/pdf" })); return data; };
    const a = sendTicketComposerAction(input, form());
    await ready;
    const b = await sendTicketComposerAction(input, form());
    expect(b).toEqual({ ok: true });
    refuseFirst();
    expect(await a).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(bytesPresent).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ validate: vi.fn(), prepare: vi.fn(), send: vi.fn(), store: vi.fn(), internal: vi.fn(), client: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("../lib/tickets/ticket-voice-file", () => ({ validateTicketVoiceFile: f.validate }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: f.client, getInternalContext: f.internal }));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({}) }));
vi.mock("../repositories/ticket-attachment-storage-repository", () => ({ TicketAttachmentStorageRepository: class {
  checksum() { return "a".repeat(64); }
  storeOrConfirm = f.store;
} }));
const { sendTicketComposerAction } = await import("../app/actions/tickets");
const input = { requestId: "test-request", mode: "client" as const, target: { kind: "ticket" as const, ticketId: "test-ticket" } };
const form = (type = "audio/webm") => { const data = new FormData(); data.set("body", ""); data.set("attachment", new File(["audio"], "voice.webm", { type })); return data; };

beforeEach(() => {
  vi.resetAllMocks();
  const tickets = { prepareAttachment: f.prepare, sendWithAttachment: f.send };
  f.client.mockResolvedValue({ actor: { id: "client" }, services: { tickets } });
  f.internal.mockResolvedValue({ user: { tickets: { reply: true } }, actor: { id: "staff" }, services: { tickets } });
  f.prepare.mockResolvedValue({ storage_key: "actor/test-request" });
  f.validate.mockResolvedValue({ ok: true, mimeType: "audio/webm", originalName: "voice.webm", sizeBytes: 5 });
});

describe("Ticket voice mutation authorization", () => {
  it("sends client audio through the existing authorized attachment claim and integrity path", async () => {
    expect(await sendTicketComposerAction(input, form())).toEqual({ ok: true });
    expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ ticket_id: "test-ticket", order_id: null }), expect.objectContaining({ id: "client" }));
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.validate.mock.invocationCallOrder[0]!);
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.store.mock.invocationCallOrder[0]!);
    expect(f.store).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ attachment: expect.objectContaining({ mime_type: "audio/webm", checksum_sha256: "a".repeat(64) }) }), expect.objectContaining({ id: "client" }));
  });
  it("requires a genuine client context before validating or uploading audio", async () => {
    f.client.mockRejectedValue(new Error("Authentication required"));
    await expect(sendTicketComposerAction(input, form())).rejects.toThrow("Authentication required");
    expect(f.validate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("cannot retarget audio through an Order or a mismatched reply source", async () => {
    expect(await sendTicketComposerAction({ ...input, target: { kind: "order", orderId: "test-order" } }, form())).toMatchObject({ ok: false });
    expect(await sendTicketComposerAction({ ...input, replyTo: { ticketId: "other-ticket", messageId: "message" } }, form())).toMatchObject({ ok: false });
    expect(f.validate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("keeps audio out of internal notes", async () => {
    expect(await sendTicketComposerAction({ ...input, mode: "note" }, form())).toMatchObject({ ok: false });
    expect(f.validate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("keeps internal reply permission checks ahead of media validation", async () => {
    f.internal.mockResolvedValue({ user: { tickets: { reply: false } }, actor: { id: "staff" } });
    expect(await sendTicketComposerAction({ ...input, mode: "admin" }, form())).toMatchObject({ ok: false });
    expect(f.validate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("allows a permitted internal reply without bypassing the attachment claim", async () => {
    expect(await sendTicketComposerAction({ ...input, mode: "admin" }, form())).toEqual({ ok: true });
    expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ ticket_id: "test-ticket" }), expect.objectContaining({ id: "staff" }));
    expect(f.client).not.toHaveBeenCalled(); expect(f.store).toHaveBeenCalledTimes(1);
  });
  it.each(["Conversation unavailable", "Upload rate limit reached"])("does not read, parse or store bytes when admission refuses: %s", async (error) => {
    f.prepare.mockRejectedValue(new Error(error));
    const data = form();
    const read = vi.spyOn(data.get("attachment") as File, "arrayBuffer");
    expect(await sendTicketComposerAction(input, data)).toMatchObject({ ok: false });
    expect(read).not.toHaveBeenCalled(); expect(f.validate).not.toHaveBeenCalled();
    expect(f.store).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("does not upload a recording refused by media validation", async () => {
    f.validate.mockResolvedValue({ ok: false, error: "Unsupported audio" });
    expect(await sendTicketComposerAction(input, form())).toEqual({ ok: false, error: "Unsupported audio" });
    expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.store).not.toHaveBeenCalled();
  });
  it("routes every declared audio type through the strict voice validator", async () => {
    f.validate.mockResolvedValue({ ok: false, error: "Unsupported audio" });
    expect(await sendTicketComposerAction(input, form("audio/mp4"))).toMatchObject({ ok: false });
    expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.validate).toHaveBeenCalledTimes(1); expect(f.store).not.toHaveBeenCalled();
  });
  it("keeps rejected ordinary attachments ahead of upload admission", async () => {
    expect(await sendTicketComposerAction(input, form("application/pdf"))).toMatchObject({ ok: false });
    expect(f.validate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
  });
  it("does not finalize when attachment storage fails", async () => {
    f.store.mockRejectedValue(new Error("Upload unavailable"));
    expect(await sendTicketComposerAction(input, form())).toMatchObject({ ok: false });
    expect(f.send).not.toHaveBeenCalled();
  });
});

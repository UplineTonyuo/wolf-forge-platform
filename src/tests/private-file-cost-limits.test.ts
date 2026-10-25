import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadIntakeFile } from "../app/actions/intake-files";
import { GET as downloadIntakeFile } from "../app/api/intake-files/[fileId]/route";
import { GET as downloadTicketFile } from "../app/api/ticket-attachments/[attachmentId]/route";
import { DatabaseError, PermissionDeniedError, RateLimitedError } from "../lib/errors/application-error";
import { createUserSupabaseClient, verifyActor, type VerifiedActor } from "../lib/supabase/user-client";
import { TeamVoiceService } from "../services/team-voice-service";

const m = vi.hoisted(() => ({
  limit: vi.fn(), rpc: vi.fn(), store: vi.fn(), download: vi.fn(), attachment: vi.fn(), probe: vi.fn(), actor: null as unknown,
}));
vi.mock("../lib/security/server-cost-limit", () => ({ enforceServerCostLimit: m.limit }));
vi.mock("../lib/supabase/next-server", () => ({
  getClientContext: async () => ({ actor: m.actor, client: { rpc: m.rpc } }),
  getSelfServiceContext: async () => ({ actor: m.actor, client: { rpc: m.rpc } }),
}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({}) }));
vi.mock("../repositories/ticket-attachment-storage-repository", () => ({
  TicketAttachmentStorageRepository: class {
    checksum() { return "a".repeat(64); }
    storeOrConfirm = m.store;
    download = m.download;
  },
}));
vi.mock("../lib/team-voice/media-inspection", () => ({ inspectTeamVoiceBytes: m.probe }));
vi.mock("../repositories/ticket-repository", () => ({ TicketRepository: class {} }));
vi.mock("../services/ticket-service", () => ({ TicketService: class { attachmentDownload = m.attachment; } }));

const actorId = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";
const assignmentId = "30000000-0000-4000-8000-000000000001";
const fieldKey = "40000000-0000-4000-8000-000000000001";
const conversationId = "50000000-0000-4000-8000-000000000001";
const fileInfo = { id: fileId, name: "synthetic.pdf", mime: "application/pdf", size: 12, path: "tenant/assignment/file" };

beforeEach(async () => {
  vi.clearAllMocks();
  m.limit.mockReset().mockResolvedValue(undefined);
  m.rpc.mockReset().mockResolvedValue({ data: fileInfo.path, error: null });
  m.store.mockResolvedValue(false);
  m.download.mockResolvedValue(new Blob(["%PDF-1.7\nQA"], { type: "application/pdf" }));
  m.attachment.mockReset().mockResolvedValue({ storage_object_key: fileInfo.path, mime_type: fileInfo.mime, original_name: fileInfo.name });
  m.probe.mockResolvedValue({ durationMs: 1000, sizeBytes: 12, mimeType: "audio/webm" });
  const client = createUserSupabaseClient({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "synthetic" }, "synthetic-token");
  vi.spyOn(client.auth, "getClaims").mockResolvedValue({ data: { claims: { sub: actorId } }, error: null } as never);
  m.actor = await verifyActor(client);
});

const input = { id: fileId, assignmentId, fieldKey };
function form() {
  const data = new FormData();
  data.set("file", new File(["%PDF-1.7\nQA"], "synthetic.pdf", { type: "application/pdf" }));
  return data;
}

describe("intake upload spend boundary", () => {
  it("counts exact replays before Storage while preserving both checksum/readback steps", async () => {
    for (let i = 0; i < 2; i++) expect((await uploadIntakeFile(input, form())).ok).toBe(true);
    expect(m.limit).toHaveBeenCalledTimes(2);
    expect(m.limit).toHaveBeenCalledWith({ actorId, action: "intake.file_upload" });
    expect(m.limit.mock.invocationCallOrder[0]).toBeLessThan(m.store.mock.invocationCallOrder[0]!);
    expect(m.store).toHaveBeenCalledTimes(4);
    expect(m.rpc.mock.calls.filter(([name]) => name === "app_finish_intake_file")).toHaveLength(2);
  });

  it.each([new RateLimitedError(), new DatabaseError()])("fails closed before upload claims or Storage when quota cannot be obtained: %s", async (error) => {
    m.limit.mockRejectedValue(error);
    expect(await uploadIntakeFile(input, form())).toMatchObject({ ok: false });
    expect(m.store).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses malformed identifiers before quota or provider work", async () => {
    expect(await uploadIntakeFile({ ...input, id: "forged" }, form())).toMatchObject({ ok: false });
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.store).not.toHaveBeenCalled();
  });
});

describe("private intake download spend boundary", () => {
  const request = () => downloadIntakeFile(new Request("http://localhost/api/intake-files/" + fileId), { params: Promise.resolve({ fileId }) });

  it("authorizes the exact file, consumes quota, then proxies it privately", async () => {
    m.rpc.mockResolvedValue({ data: fileInfo, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(m.limit).toHaveBeenCalledWith({ actorId, action: "intake.file_download" });
    expect(m.rpc.mock.invocationCallOrder[0]).toBeLessThan(m.limit.mock.invocationCallOrder[0]!);
    expect(m.limit.mock.invocationCallOrder[0]).toBeLessThan(m.download.mock.invocationCallOrder[0]!);
    expect(m.download).toHaveBeenCalledWith(fileInfo.path);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 429 with a retry hint and never downloads when capped", async () => {
    m.rpc.mockResolvedValue({ data: fileInfo, error: null }); m.limit.mockRejectedValue(new RateLimitedError());
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(m.download).not.toHaveBeenCalled();
  });

  it("fails closed on limiter outage and on a denied file", async () => {
    m.rpc.mockResolvedValue({ data: fileInfo, error: null }); m.limit.mockRejectedValue(new DatabaseError());
    expect((await request()).ok).toBe(false);
    expect(m.download).not.toHaveBeenCalled();
    m.limit.mockClear(); m.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await request()).status).toBe(403);
    expect(m.limit).not.toHaveBeenCalled();
  });
});

describe("ticket and Project attachment download spend boundary", () => {
  const request = () => downloadTicketFile(new Request("http://localhost/api/ticket-attachments/" + fileId), { params: Promise.resolve({ attachmentId: fileId }) });
  it("keeps attachment authorization first and quota before provider bytes, including image reloads", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(m.limit).toHaveBeenCalledWith({ actorId, action: "ticket.file_download" });
    expect(m.attachment.mock.invocationCallOrder[0]).toBeLessThan(m.limit.mock.invocationCallOrder[0]!);
    expect(m.limit.mock.invocationCallOrder[0]).toBeLessThan(m.download.mock.invocationCallOrder[0]!);
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
  });
  it("returns 429 with no provider reads when capped", async () => {
    m.limit.mockRejectedValue(new RateLimitedError());
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(m.download).not.toHaveBeenCalled();
  });
  it("does not read bytes on limiter outage or a denied attachment", async () => {
    m.limit.mockRejectedValue(new DatabaseError());
    expect((await request()).ok).toBe(false);
    expect(m.download).not.toHaveBeenCalled();
    m.limit.mockClear(); m.attachment.mockRejectedValue(new PermissionDeniedError());
    expect((await request()).status).toBe(403);
    expect(m.limit).not.toHaveBeenCalled();
  });
});

function voiceFixture() {
  const team = {
    getVoiceUploadContext: vi.fn().mockResolvedValue({ upload_id: fileId, conversation_id: conversationId,
      storage_path: "voice/synthetic", status: "finalized", declared_mime_type: "audio/webm" }),
    getConversation: vi.fn().mockResolvedValue({ my_capabilities: { can_send_voice: true } }),
    finalizeVoiceUpload: vi.fn().mockResolvedValue({ id: "accepted-message" }),
  };
  const storage = { inspectObject: vi.fn().mockResolvedValue({ bytes: new Uint8Array(12), size: 12, contentType: "audio/webm" }) };
  return { team, storage, service: new TeamVoiceService(team as never, storage as never) };
}

describe("voice finalization replay spend boundary", () => {
  it("counts each replay before bytes/probe and retains canonical database finalization", async () => {
    const f = voiceFixture();
    for (let i = 0; i < 2; i++) await expect(f.service.finalizeUpload({ uploadId: fileId, recordedDurationMs: 1000 }, m.actor as VerifiedActor)).resolves.toEqual({ id: "accepted-message" });
    expect(m.limit).toHaveBeenCalledTimes(2);
    expect(m.limit).toHaveBeenCalledWith({ actorId, action: "team.voice.finalize" });
    expect(m.limit.mock.invocationCallOrder[0]).toBeLessThan(f.storage.inspectObject.mock.invocationCallOrder[0]!);
    expect(f.team.finalizeVoiceUpload).toHaveBeenCalledTimes(2);
    expect(f.team.finalizeVoiceUpload).toHaveBeenCalledWith(expect.objectContaining({ uploadId: fileId, durationMs: 1000, sizeBytes: 12, mimeType: "audio/webm" }));
  });

  it.each([new RateLimitedError(), new DatabaseError()])("refuses before media download and parsing when quota fails: %s", async (error) => {
    const f = voiceFixture(); m.limit.mockRejectedValue(error);
    await expect(f.service.finalizeUpload({ uploadId: fileId, recordedDurationMs: 1000 }, m.actor as VerifiedActor)).rejects.toBe(error);
    expect(f.storage.inspectObject).not.toHaveBeenCalled();
    expect(m.probe).not.toHaveBeenCalled();
    expect(f.team.finalizeVoiceUpload).not.toHaveBeenCalled();
  });

  it("refuses a forged actor or missing conversation capability before quota", async () => {
    const f = voiceFixture();
    await expect(f.service.finalizeUpload({ uploadId: fileId, recordedDurationMs: 1000 }, { id: actorId } as VerifiedActor)).rejects.toThrow();
    expect(f.team.getVoiceUploadContext).not.toHaveBeenCalled();
    f.team.getConversation.mockRejectedValue(new PermissionDeniedError());
    await expect(f.service.finalizeUpload({ uploadId: fileId, recordedDurationMs: 1000 }, m.actor as VerifiedActor)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(m.limit).not.toHaveBeenCalled();
  });
});

describe("durable replay quota migration", () => {
  it("adds only the four new scopes without changing prior limits or privileges", () => {
    const old = readFileSync(new URL("../../supabase/migrations/20260827100220_authenticated_cost_limits.sql", import.meta.url), "utf8");
    const next = readFileSync(new URL("../../supabase/migrations/20261024130000_private_file_replay_cost_limits.sql", import.meta.url), "utf8");
    const priorBranches = old.slice(old.indexOf("    when 'search.global'"), old.indexOf("    else"));
    expect(next).toContain(priorBranches);
    expect(next.slice(next.indexOf("    else"))).toBe(old.slice(old.indexOf("    else")));
    expect(next).toContain("from public, anon, authenticated");
    expect(next).toContain("to service_role;");
    for (const [scope, minute, hour] of [["intake.file_upload", 20, 60], ["private.file_download", 60, 300], ["team.voice.finalize", 12, 120]] as const) {
      expect(next).toContain(`'cost.${scope}.actor.minute', p_actor_id::text, interval '1 minute', ${minute}`);
      expect(next).toContain(`'cost.${scope}.actor.hour', p_actor_id::text, interval '1 hour', ${hour}`);
    }
    const intake = next.slice(next.indexOf("    when 'intake.file_download'"), next.indexOf("    when 'ticket.file_download'"));
    const tickets = next.slice(next.indexOf("    when 'ticket.file_download'"), next.indexOf("    when 'team.voice.finalize'"));
    expect(intake.replace("'intake.file_download'", "'ticket.file_download'").trim()).toBe(tickets.trim());
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserSupabaseClient, verifyActor } from "../lib/supabase/user-client";
import { PermissionDeniedError } from "../lib/errors/application-error";
import { TeamVoiceCleanupService, TeamVoiceService } from "../services/team-voice-service";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const CONVERSATION = "20000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "20000000-0000-4000-8000-000000000002";
const UPLOAD = "30000000-0000-4000-8000-000000000001";
const MESSAGE = "40000000-0000-4000-8000-000000000001";

async function actor() {
  const client = createUserSupabaseClient(
    { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "local-key" },
    "test-token",
  );
  vi.spyOn(client.auth, "getClaims").mockResolvedValue({
    data: { claims: { sub: ACTOR } }, error: null,
  } as never);
  return verifyActor(client);
}

function dependencies(canSendVoice = true) {
  const team = {
    getConversation: vi.fn().mockResolvedValue({ my_capabilities: { can_send_voice: canSendVoice } }),
    prepareVoiceUpload: vi.fn().mockResolvedValue({
      upload_id: UPLOAD, conversation_id: CONVERSATION,
      storage_path: `${CONVERSATION}/${UPLOAD}/audio.webm`,
      declared_mime_type: "audio/webm", expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
    getVoiceUploadContext: vi.fn(),
    finalizeVoiceUpload: vi.fn(),
    getVoicePlayback: vi.fn(),
  };
  const storage = {
    createSignedUploadUrl: vi.fn().mockResolvedValue("https://storage.invalid/signed-upload"),
    inspectObject: vi.fn(),
    createSignedPlaybackUrl: vi.fn().mockResolvedValue("https://storage.invalid/signed-playback"),
  };
  return { team, storage, service: new TeamVoiceService(team as never, storage as never) };
}

describe("TeamVoiceService authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["owner", "admin"])("allows a conversation %s capability to request one constrained slot", async () => {
    const { service, team, storage } = dependencies(true);
    const result = await service.prepareUpload({
      conversationId: CONVERSATION,
      mimeType: "audio/webm;codecs=opus",
      senderId: "spoofed",
    }, await actor());
    expect(result.uploadId).toBe(UPLOAD);
    expect(team.prepareVoiceUpload).toHaveBeenCalledWith({ conversationId: CONVERSATION, mimeType: "audio/webm;codecs=opus" });
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${CONVERSATION}/${UPLOAD}/audio.webm`);
  });

  it("blocks a normal member before any upload capability is minted", async () => {
    const { service, team, storage } = dependencies(false);
    await expect(service.prepareUpload({ conversationId: CONVERSATION, mimeType: "audio/webm" }, await actor()))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    expect(team.prepareVoiceUpload).not.toHaveBeenCalled();
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("blocks a client or nonmember when the conversation read boundary refuses them", async () => {
    const { service, team } = dependencies(true);
    team.getConversation.mockRejectedValue(new PermissionDeniedError());
    await expect(service.prepareUpload({ conversationId: CONVERSATION, mimeType: "audio/webm" }, await actor()))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("does not mint playback for a client-supplied cross-conversation relationship", async () => {
    const { service, team, storage } = dependencies(true);
    team.getVoicePlayback.mockResolvedValue({
      message_id: MESSAGE, conversation_id: OTHER_CONVERSATION,
      storage_path: `${OTHER_CONVERSATION}/${UPLOAD}/audio.webm`,
      mime_type: "audio/webm", duration_ms: 1000, expired_at: null,
    });
    await expect(service.playback({ conversationId: CONVERSATION, messageId: MESSAGE }, await actor()))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    expect(storage.createSignedPlaybackUrl).not.toHaveBeenCalled();
  });

  it("refuses expired playback metadata", async () => {
    const { service, team } = dependencies(true);
    team.getVoicePlayback.mockResolvedValue({
      message_id: MESSAGE, conversation_id: CONVERSATION, storage_path: null,
      mime_type: "audio/webm", duration_ms: 1000, expired_at: new Date().toISOString(),
    });
    await expect(service.playback({ conversationId: CONVERSATION, messageId: MESSAGE }, await actor()))
      .rejects.toThrow("Voice recording was not found");
  });
});

describe("TeamVoiceCleanupService", () => {
  it("processes a bounded expired-only batch and is safe to run again", async () => {
    const row = { object_kind: "message", record_id: MESSAGE, storage_path: `${CONVERSATION}/${UPLOAD}/audio.webm` };
    const storage = {
      listCleanupBatch: vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]),
      removeObject: vi.fn().mockResolvedValue(undefined),
      markCleanupComplete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TeamVoiceCleanupService(storage as never);
    await expect(service.runBatch(10)).resolves.toEqual({ selected: 1, removed: 1, failed: 0 });
    await expect(service.runBatch(10)).resolves.toEqual({ selected: 0, removed: 0, failed: 0 });
    expect(storage.removeObject).toHaveBeenCalledTimes(1);
  });

  it("keeps canonical metadata pending when Storage deletion fails", async () => {
    const storage = {
      listCleanupBatch: vi.fn().mockResolvedValue([{ object_kind: "message", record_id: MESSAGE, storage_path: "safe/path" }]),
      removeObject: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      markCleanupComplete: vi.fn(),
    };
    const service = new TeamVoiceCleanupService(storage as never);
    await expect(service.runBatch()).resolves.toEqual({ selected: 1, removed: 0, failed: 1 });
    expect(storage.markCleanupComplete).not.toHaveBeenCalled();
  });

  it("bounds a caller-supplied batch size", async () => {
    const storage = { listCleanupBatch: vi.fn().mockResolvedValue([]) };
    await new TeamVoiceCleanupService(storage as never).runBatch(10_000);
    expect(storage.listCleanupBatch).toHaveBeenCalledWith(250);
  });
});

import { describe, expect, it } from "vitest";
import { parseBuffer } from "music-metadata";
import { inspectTeamVoiceBytes } from "../lib/team-voice/media-inspection";
import { streamingWebm } from "./fixtures/team-voice-streaming";

function inspect(bytes: Uint8Array, recordedDurationMs = 16_000) {
  return inspectTeamVoiceBytes({ bytes, objectSize: bytes.length, objectMimeType: "audio/webm;codecs=opus", declaredMimeType: "audio/webm", recordedDurationMs });
}

describe("Team voice streaming WebM through the installed metadata parser", () => {
  it("derives a missing Duration from the audio bytes instead of rejecting MediaRecorder-style WebM", async () => {
    const bytes = streamingWebm();
    const metadata = await parseBuffer(bytes, { mimeType: "audio/webm" }, { duration: true });
    expect(metadata.format.container).toMatch(/webm/i);
    expect(metadata.format.codec).toMatch(/opus/i);
    expect(metadata.format.duration).toBeUndefined();
    await expect(inspect(bytes)).resolves.toEqual({ mimeType: "audio/webm", sizeBytes: bytes.length, durationMs: 16_020 });
  });

  it("does not trust a conflicting browser timer when Duration is absent", async () => {
    await expect(inspect(streamingWebm(), 1_000)).rejects.toThrow("duration could not be verified");
  });

  it("accepts the five-minute boundary and rejects longer byte-derived recordings", async () => {
    await expect(inspect(streamingWebm(299_980), 300_000)).resolves.toMatchObject({ durationMs: 300_000 });
    await expect(inspect(streamingWebm(300_001), 300_000)).rejects.toThrow("5 minutes or shorter");
  });

  it("keeps the upload-slot MIME boundary when deriving duration", async () => {
    const bytes = streamingWebm();
    await expect(inspectTeamVoiceBytes({ bytes, objectSize: bytes.length, objectMimeType: "audio/webm", declaredMimeType: "audio/ogg", recordedDurationMs: 16_000 })).rejects.toThrow("does not match");
  });

  it("rejects unsupported lacing and truncated bytes instead of using the browser timer", async () => {
    await expect(inspect(streamingWebm(16_000, 0x82))).rejects.toThrow("not supported");
    await expect(inspect(streamingWebm().slice(0, -2))).rejects.toThrow("not supported");
  });
});

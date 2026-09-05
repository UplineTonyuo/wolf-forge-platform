import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBuffer } from "music-metadata";
import { teamVoiceMaxBytes } from "../domain/team/schema";
import { readTeamVoiceRetentionDays } from "../lib/env/team-voice-env";
import { inspectTeamVoiceBytes } from "../lib/team-voice/media-inspection";

vi.mock("music-metadata", () => ({ parseBuffer: vi.fn() }));

const mockedParse = vi.mocked(parseBuffer);
const bytes = new Uint8Array([1, 2, 3, 4]);

describe("Team voice media validation", () => {
  beforeEach(() => mockedParse.mockReset());

  it("accepts server-probed WebM/Opus metadata", async () => {
    mockedParse.mockResolvedValue({ format: { container: "WebM", codec: "Opus", duration: 4.2 } } as never);
    await expect(inspectTeamVoiceBytes({
      bytes, objectSize: bytes.byteLength, objectMimeType: "audio/webm;codecs=opus",
      declaredMimeType: "audio/webm", recordedDurationMs: 4200,
    })).resolves.toEqual({ durationMs: 4200, sizeBytes: 4, mimeType: "audio/webm" });
  });

  it("rejects oversized audio before probing", async () => {
    await expect(inspectTeamVoiceBytes({
      bytes, objectSize: teamVoiceMaxBytes + 1, objectMimeType: "audio/webm",
      declaredMimeType: "audio/webm", recordedDurationMs: 1000,
    })).rejects.toThrow("smaller than 5 MB");
    expect(mockedParse).not.toHaveBeenCalled();
  });

  it("rejects unsupported codecs, MIME mismatches, and recordings over five minutes", async () => {
    mockedParse.mockResolvedValueOnce({ format: { container: "WAVE", codec: "PCM", duration: 2 } } as never);
    await expect(inspectTeamVoiceBytes({ bytes, objectSize: 4, objectMimeType: "audio/wav", declaredMimeType: "audio/webm", recordedDurationMs: 2000 })).rejects.toThrow("not supported");
    mockedParse.mockResolvedValueOnce({ format: { container: "WebM", codec: "Opus", duration: 301 } } as never);
    await expect(inspectTeamVoiceBytes({ bytes, objectSize: 4, objectMimeType: "audio/webm", declaredMimeType: "audio/webm", recordedDurationMs: 300000 })).rejects.toThrow("5 minutes or shorter");
    mockedParse.mockResolvedValueOnce({ format: { container: "WebM", codec: "Opus", duration: 2 } } as never);
    await expect(inspectTeamVoiceBytes({ bytes, objectSize: 4, objectMimeType: "audio/ogg", declaredMimeType: "audio/ogg", recordedDurationMs: 2000 })).rejects.toThrow("does not match");
  });
});

describe("Team voice retention configuration", () => {
  it("defaults safely to 90 days and permits a future 180-day policy", () => {
    expect(readTeamVoiceRetentionDays({})).toBe(90);
    expect(readTeamVoiceRetentionDays({ TEAM_VOICE_RETENTION_DAYS: "180" })).toBe(180);
  });

  it("clamps malformed or unsafe values to the supported range", () => {
    expect(readTeamVoiceRetentionDays({ TEAM_VOICE_RETENTION_DAYS: "nope" })).toBe(90);
    expect(readTeamVoiceRetentionDays({ TEAM_VOICE_RETENTION_DAYS: "1" })).toBe(30);
    expect(readTeamVoiceRetentionDays({ TEAM_VOICE_RETENTION_DAYS: "999" })).toBe(365);
  });
});

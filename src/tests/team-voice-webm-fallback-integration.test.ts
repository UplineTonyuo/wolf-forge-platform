import { describe, expect, it } from "vitest";
import { inspectTeamVoiceBytes } from "../lib/team-voice/media-inspection";
import {
  OPUS_CONFIG_60MS_SILK_NB,
  chromeStyleFixture,
  cluster,
  info,
  opusPacketTwoFrames,
  opusTrackEntry,
  simpleBlock,
  tracks,
  webmFile,
} from "./helpers/webm-opus-fixture";

/**
 * KI-058: real, UNMOCKED music-metadata end-to-end. These tests reproduce
 * the exact confirmed bug (Chrome's MediaRecorder omits the WebM Duration
 * element, so music-metadata reports `duration: undefined`) and prove the
 * server-side fallback recovers it without weakening the existing
 * music-metadata-backed path. No numeric duration is mocked anywhere here.
 */
describe("inspectTeamVoiceBytes against real music-metadata (WebM/Opus duration fallback)", () => {
  it("recovers a valid duration for a Chrome-style recording with no Duration element", async () => {
    const bytes = chromeStyleFixture(4200);
    const result = await inspectTeamVoiceBytes({
      bytes,
      objectSize: bytes.byteLength,
      objectMimeType: "audio/webm;codecs=opus",
      declaredMimeType: "audio/webm",
      recordedDurationMs: 4200,
    });
    expect(result).toEqual({ durationMs: 4200, sizeBytes: bytes.byteLength, mimeType: "audio/webm" });
  });

  it("leaves the existing music-metadata Duration path unchanged when a Duration element is present", async () => {
    // Deliberately encode far less real audio (240ms) than the declared
    // Duration (4200ms). If the result matches the declared Duration rather
    // than the actual encoded audio, the music-metadata path was used, not
    // the fallback.
    const trackNumber = 1;
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10); // 120ms
    const bytes = webmFile(
      [
        info({ durationMs: 4200 }),
        tracks([opusTrackEntry(trackNumber)]),
        cluster(0, [simpleBlock(trackNumber, 0, packet), simpleBlock(trackNumber, 120, packet)]),
      ],
      { segmentUnknownSize: false },
    );

    const result = await inspectTeamVoiceBytes({
      bytes,
      objectSize: bytes.byteLength,
      objectMimeType: "audio/webm;codecs=opus",
      declaredMimeType: "audio/webm",
      recordedDurationMs: 4200,
    });
    expect(result.durationMs).toBe(4200);
  });

  it("rejects end-to-end when the fallback's narrow profile is violated (multiple tracks), even though container/codec still resolve", async () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1), opusTrackEntry(2)]),
      cluster(0, [simpleBlock(1, 0, packet)]),
    ]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm;codecs=opus",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 120,
      }),
    ).rejects.toThrow(/not supported/);
  });
});

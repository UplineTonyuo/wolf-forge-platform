import { describe, expect, it } from "vitest";
import { inspectTeamVoiceBytes } from "../lib/team-voice/media-inspection";
import {
  OPUS_CONFIG_60MS_SILK_NB,
  block,
  buildUniformClusters,
  chromeStyleFixture,
  cluster,
  concatBytes,
  ebmlHeader,
  info,
  opusPacketTwoFrames,
  opusTrackEntry,
  segment,
  silentTracks,
  simpleBlock,
  tracks,
  trackEntry,
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

  it("rejects a second over-limit Segment instead of measuring only the first short Segment", async () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const shortSegment = segment([info(), tracks([opusTrackEntry()]), cluster(0, [simpleBlock(1, 0, packet)])]);
    const overLimitSegment = segment([
      info(),
      tracks([opusTrackEntry()]),
      ...buildUniformClusters(2501, 120, () => packet),
    ]);
    const bytes = concatBytes([ebmlHeader(), shortSegment, overLimitSegment]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 120,
      }),
    ).rejects.toThrow(/not supported/);
  });

  it("rejects a non-default TrackTimestampScale instead of undercounting the presentation timeline", async () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const entry = trackEntry({ trackNumber: 1, trackType: 2, codecId: "A_OPUS", trackTimestampScale: 1000 });
    const bytes = webmFile([
      info(),
      tracks([entry]),
      cluster(0, [simpleBlock(1, 0, packet), simpleBlock(1, 400, packet)]),
    ]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 520,
      }),
    ).rejects.toThrow(/not supported/);
  });

  it("rejects a Cluster containing a SimpleBlock when it is nested inside Info", async () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const nestedCluster = cluster(0, [simpleBlock(1, 0, packet)], { unknownSize: false });
    const bytes = webmFile([
      info({ extraChildren: [nestedCluster] }),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, packet)]),
    ]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 120,
      }),
    ).rejects.toThrow(/not supported/);
  });

  it("rejects a bare Block hidden inside SilentTracks within a Cluster", async () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, packet), silentTracks([block(1, 120, packet)])]),
    ]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 120,
      }),
    ).rejects.toThrow(/not supported/);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("rejects an explicitly invalid %s Duration instead of entering fallback", async (_label, durationMs) => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info({ durationMs }),
      tracks([opusTrackEntry()]),
      cluster(0, [simpleBlock(1, 0, packet)]),
    ]);

    await expect(
      inspectTeamVoiceBytes({
        bytes,
        objectSize: bytes.byteLength,
        objectMimeType: "audio/webm",
        declaredMimeType: "audio/webm",
        recordedDurationMs: 120,
      }),
    ).rejects.toThrow(/not supported/);
  });
});

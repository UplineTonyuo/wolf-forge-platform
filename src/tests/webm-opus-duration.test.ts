import { describe, expect, it } from "vitest";
import { teamVoiceMaxDurationMs } from "../domain/team/schema";
import { deriveWebmOpusDurationMs } from "../lib/team-voice/webm-opus-duration";
import {
  OPUS_CONFIG_20MS_CELT_NB,
  OPUS_CONFIG_60MS_SILK_NB,
  blockGroupWithBlock,
  buildUniformClusters,
  chromeStyleFixture,
  cluster,
  ebmlHeader,
  info,
  malformedCbrFrameCountOpusPacket,
  malformedOddSplitOpusPacket,
  malformedTruncatedPaddingOpusPacket,
  opusPacketCode3Cbr,
  opusPacketTwoFrames,
  opusTrackEntry,
  segment,
  simpleBlock,
  trackEntry,
  tracks,
  webmFile,
} from "./helpers/webm-opus-fixture";

describe("deriveWebmOpusDurationMs", () => {
  it("derives a valid duration for a Chrome-style fixture with no Duration element (unknown-size Segment/Cluster)", () => {
    const bytes = chromeStyleFixture(4200);
    expect(deriveWebmOpusDurationMs(bytes)).toBe(4200);
  });

  it("also derives correctly when Segment and Cluster sizes are known, not just unknown-size streaming form", () => {
    const bytes = chromeStyleFixture(2400, { clusterUnknownSize: false, segmentUnknownSize: false });
    expect(deriveWebmOpusDurationMs(bytes)).toBe(2400);
  });

  it("defaults TimestampScale to 1ms/tick when Info omits it", () => {
    const blocks = buildUniformClusters(2, 120, () => opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10));
    const bytes = webmFile([info({ omitTimestampScale: true }), tracks([opusTrackEntry()]), ...blocks]);
    expect(deriveWebmOpusDurationMs(bytes)).toBe(240);
  });

  it("accepts exactly the 5-minute boundary", () => {
    const bytes = chromeStyleFixture(teamVoiceMaxDurationMs);
    expect(deriveWebmOpusDurationMs(bytes)).toBe(teamVoiceMaxDurationMs);
  });

  it("still measures (does not silently clamp) the first duration above 5 minutes, leaving rejection to the caller", () => {
    const bytes = chromeStyleFixture(teamVoiceMaxDurationMs + 120);
    const result = deriveWebmOpusDurationMs(bytes);
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThan(teamVoiceMaxDurationMs);
  });

  it("rejects malformed EBML (wrong header magic)", () => {
    const bogusHeader = new Uint8Array([0x1a, 0x45, 0xdf, 0xa2, 0x80]); // last magic byte wrong
    expect(deriveWebmOpusDurationMs(bogusHeader)).toBeNull();
  });

  it("rejects a truncated SimpleBlock", () => {
    const full = chromeStyleFixture(120);
    const truncated = full.slice(0, full.length - 3);
    expect(deriveWebmOpusDurationMs(truncated)).toBeNull();
  });

  it("rejects a block that references an unknown/wrong track number", () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(2, 0, packet)]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects a non-Opus WebM (wrong CodecID)", () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([trackEntry({ trackNumber: 1, trackType: 2, codecId: "A_VORBIS" })]),
      cluster(0, [simpleBlock(1, 0, packet)]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects a laced SimpleBlock", () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, packet, { lacing: 1 })]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects multiple tracks", () => {
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1), opusTrackEntry(2)]),
      cluster(0, [simpleBlock(1, 0, opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10))]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects a video track", () => {
    const bytes = webmFile([
      info(),
      tracks([trackEntry({ trackNumber: 1, trackType: 1, codecId: "V_VP8" })]),
      cluster(0, []),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects BlockGroup/Block (only SimpleBlock is supported)", () => {
    const packet = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10);
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [blockGroupWithBlock(1, 0, packet)]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects when the encoded packet sum is short but the presentation timeline spans over 5 minutes", () => {
    const shortPacket = opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 4); // 120ms of real audio
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, shortPacket)]),
      cluster(400_000, [simpleBlock(1, 0, shortPacket)]), // absolute timestamp 400s later
    ]);
    const result = deriveWebmOpusDurationMs(bytes);
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThan(teamVoiceMaxDurationMs);
  });

  it("rejects when the presentation timeline is short but the summed encoded Opus duration exceeds 5 minutes", () => {
    // Every block declares the same relative timestamp (timeline stays ~120ms),
    // but each carries 120ms of real encoded audio, so the encoded-duration
    // accumulator alone must catch this — an attacker cannot hide total
    // encoded audio behind understated timestamps.
    const blockCount = Math.ceil(teamVoiceMaxDurationMs / 120) + 1;
    const blocks = Array.from({ length: blockCount }, () =>
      simpleBlock(1, 0, opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10)),
    );
    const bytes = webmFile([info(), tracks([opusTrackEntry(1)]), cluster(0, blocks)]);
    const result = deriveWebmOpusDurationMs(bytes);
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThan(teamVoiceMaxDurationMs);
  });

  it("rejects malformed Opus framing: odd remaining bytes for a two-frame (code=1) packet", () => {
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, malformedOddSplitOpusPacket(OPUS_CONFIG_20MS_CELT_NB))]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects malformed Opus framing: code=3 CBR frame count that does not evenly divide the data", () => {
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, malformedCbrFrameCountOpusPacket(OPUS_CONFIG_20MS_CELT_NB))]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects malformed Opus framing: code=3 padding flag set with no bytes left to encode the padding length", () => {
    const bytes = webmFile([
      info(),
      tracks([opusTrackEntry(1)]),
      cluster(0, [simpleBlock(1, 0, malformedTruncatedPaddingOpusPacket(OPUS_CONFIG_20MS_CELT_NB))]),
    ]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("accepts a valid code=3 CBR packet and sums its frames correctly", () => {
    // 6 frames * 20ms = 120ms in one packet (right at the 120ms/packet cap).
    const packet = opusPacketCode3Cbr(OPUS_CONFIG_20MS_CELT_NB, 6, 4);
    const bytes = webmFile([info(), tracks([opusTrackEntry(1)]), cluster(0, [simpleBlock(1, 0, packet)])]);
    expect(deriveWebmOpusDurationMs(bytes)).toBe(120);
  });

  it("rejects a packet whose declared frames would exceed 120ms", () => {
    // 7 frames * 20ms = 140ms, over the RFC 6716 per-packet cap.
    const packet = opusPacketCode3Cbr(OPUS_CONFIG_20MS_CELT_NB, 7, 4);
    const bytes = webmFile([info(), tracks([opusTrackEntry(1)]), cluster(0, [simpleBlock(1, 0, packet)])]);
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });

  it("rejects garbage bytes entirely", () => {
    expect(deriveWebmOpusDurationMs(new Uint8Array([0, 1, 2, 3, 4]))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(deriveWebmOpusDurationMs(new Uint8Array(0))).toBeNull();
  });

  it("rejects a Tracks-only file with no Cluster at all", () => {
    const bytes = concatSegmentOnly();
    expect(deriveWebmOpusDurationMs(bytes)).toBeNull();
  });
});

function concatSegmentOnly(): Uint8Array {
  const header = ebmlHeader();
  const body = segment([info(), tracks([opusTrackEntry(1)])]);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

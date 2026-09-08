import "server-only";

import { teamVoiceMaxBytes, teamVoiceMaxDurationMs } from "../../domain/team/schema";

/**
 * Bounded, fail-closed fallback duration reader for the narrow "Team Voice"
 * WebM/Opus profile Chrome's MediaRecorder produces:
 *
 *   EBML -> Segment -> Info/Tracks -> exactly one Opus audio track -> Cluster* -> SimpleBlock*
 *
 * This is NOT a general Matroska parser. Anything outside that shape
 * (BlockGroup/Block, lacing, multiple/non-audio tracks, unknown track
 * references, malformed Opus framing, malformed/overflowing timestamps)
 * causes the whole file to be rejected (`null`), never partially trusted.
 *
 * Every element/vint read is bounded against the *local* container's end,
 * not just the overall buffer, so a crafted vint length can never read
 * across an element boundary into a sibling's bytes. Depth is fixed by
 * construction (dedicated functions per element type, no generic recursive
 * descent), not by a runtime counter.
 *
 * Only invoked by media-inspection.ts as a fallback when music-metadata has
 * already recognized the container/codec but found no Duration element.
 */

const ID_EBML_HEADER = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMESTAMP_SCALE = 0x2ad7b1;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_CLUSTER = 0x1f43b675;
const ID_CLUSTER_TIMESTAMP = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;

// Recognized-but-unparsed Segment-level siblings. Only used to decide where
// an unknown-size Cluster ends, and to safely skip a known-size element we
// do not need. Never entered.
const SEGMENT_LEVEL_IDS = new Set<number>([
  ID_INFO,
  ID_TRACKS,
  ID_CLUSTER,
  0x1c53bb6b, // Cues
  0x114d9b74, // SeekHead
  0x1254c367, // Tags
  0x1043a770, // Chapters
  0x1941a469, // Attachments
]);

// Recognized Cluster-level children. BlockGroup is recognized only so it can
// be explicitly rejected, never silently skipped.
const CLUSTER_CHILD_IDS = new Set<number>([
  ID_CLUSTER_TIMESTAMP,
  ID_SIMPLE_BLOCK,
  ID_BLOCK_GROUP,
  0xa7, // Position
  0xab, // PrevSize
  0x5854, // SilentTracks
]);

const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;
const OPUS_CODEC_ID = "A_OPUS";
const DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000n; // Matroska default: 1ms per tick

const MAX_ELEMENTS = 400_000;
const MAX_BLOCKS = 200_000;
const MAX_PACKET_BYTES = 1_500; // generous upper bound on a single Opus packet
const MAX_PACKET_SAMPLES_48K = 5_760; // RFC 6716: a packet spans at most 120ms
const MAX_PLAUSIBLE_NS = 2n * 3_600n * 1_000_000_000n; // 2 hours; far beyond any real 5-minute clip

// RFC 6716 Table 2: samples-at-48kHz per frame, indexed by the 5-bit Opus TOC config.
const FRAME_SAMPLES_48K: readonly number[] = [
  480, 960, 1920, 2880, // 0-3   NB SILK   10/20/40/60 ms
  480, 960, 1920, 2880, // 4-7   MB SILK   10/20/40/60 ms
  480, 960, 1920, 2880, // 8-11  WB SILK   10/20/40/60 ms
  480, 960, // 12-13 SWB Hybrid 10/20 ms
  480, 960, // 14-15 FB Hybrid  10/20 ms
  120, 240, 480, 960, // 16-19 NB CELT  2.5/5/10/20 ms
  120, 240, 480, 960, // 20-23 WB CELT  2.5/5/10/20 ms
  120, 240, 480, 960, // 24-27 SWB CELT 2.5/5/10/20 ms
  120, 240, 480, 960, // 28-31 FB CELT  2.5/5/10/20 ms
];

type VintResult = { value: number; length: number; unknown: boolean };

/** Reads one EBML vint at `offset`. Every byte read is bounded by `limit` (a local container end, never just the buffer end) so a crafted length can never bleed into a sibling element. */
function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean, limit: number): VintResult | null {
  if (offset < 0 || offset >= limit) return null;
  const first = bytes[offset]!; // bounds-checked by the guard above
  if (first === 0) return null; // would require a >8-byte vint; unsupported and never legitimate here
  let markerBit = 0x80;
  let length = 1;
  while ((first & markerBit) === 0) {
    markerBit >>= 1;
    length++;
  }
  if (length > 8) return null;
  if (offset + length > limit) return null; // truncated / extends past this container's end

  const dataMask = markerBit - 1;
  let value = keepMarker ? first : first & dataMask;
  let unknown = !keepMarker && (first & dataMask) === dataMask;
  for (let i = 1; i < length; i++) {
    const b = bytes[offset + i]!; // offset + length <= limit was already validated above
    value = value * 256 + b;
    if (b !== 0xff) unknown = false;
    if (!Number.isSafeInteger(value)) return null;
  }
  return { value, length, unknown };
}

type ElementHeader = { id: number; size: number; unknown: boolean; contentStart: number };

/** Reads an element's id+size header, bounded by `limit`. Does not itself validate that the content fits within `limit` — callers must check `contentStart + size <= limit`. */
function readElementHeader(bytes: Uint8Array, pos: number, limit: number): ElementHeader | null {
  const idInfo = readVint(bytes, pos, true, limit);
  if (!idInfo) return null;
  const sizeInfo = readVint(bytes, pos + idInfo.length, false, limit);
  if (!sizeInfo) return null;
  return {
    id: idInfo.value,
    size: sizeInfo.value,
    unknown: sizeInfo.unknown,
    contentStart: pos + idInfo.length + sizeInfo.length,
  };
}

function readUintContent(bytes: Uint8Array, offset: number, length: number, limit: number): number | null {
  if (length < 1 || length > 8) return null;
  if (offset + length > limit) return null;
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + bytes[offset + i]!; // offset + length <= limit was validated above
    if (!Number.isSafeInteger(value)) return null;
  }
  return value;
}

function readAsciiContent(bytes: Uint8Array, offset: number, length: number, limit: number): string | null {
  if (length < 0 || offset + length > limit) return null;
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]!); // bounds-checked above
  return out;
}

/** Parses exactly one Opus packet's framing (RFC 6716 §3) and returns its duration in 48kHz samples, or null if malformed. */
function parseOpusPacketSamples(bytes: Uint8Array, offset: number, length: number): number | null {
  if (length < 1 || length > MAX_PACKET_BYTES) return null;
  const toc = bytes[offset]!; // length >= 1 guarantees offset is in range
  const config = (toc >> 3) & 0x1f;
  const code = toc & 0x03;
  const frameSamples = FRAME_SAMPLES_48K[config];
  if (frameSamples === undefined) return null; // unreachable given config is always 0-31, kept explicit for safety
  const packetEnd = offset + length;
  let cursor = offset + 1;

  const readFrameLength = (): number | null => {
    if (cursor >= packetEnd) return null;
    const b0 = bytes[cursor]!; // bounds-checked above
    if (b0 < 252) {
      cursor += 1;
      return b0;
    }
    if (cursor + 1 >= packetEnd) return null;
    const b1 = bytes[cursor + 1]!; // bounds-checked above
    cursor += 2;
    return 4 * b1 + b0;
  };

  let frameCount: number;
  let frameLengths: number[];
  let padding = 0;

  if (code === 0) {
    frameCount = 1;
    frameLengths = [packetEnd - cursor];
  } else if (code === 1) {
    const remaining = packetEnd - cursor;
    if (remaining < 0 || remaining % 2 !== 0) return null;
    frameCount = 2;
    frameLengths = [remaining / 2, remaining / 2];
  } else if (code === 2) {
    const first = readFrameLength();
    if (first === null) return null;
    const second = packetEnd - cursor - first;
    if (second < 0) return null;
    frameCount = 2;
    frameLengths = [first, second];
  } else {
    if (cursor >= packetEnd) return null;
    const countByte = bytes[cursor]!; // bounds-checked above
    cursor += 1;
    const vbr = (countByte & 0x80) !== 0;
    const hasPadding = (countByte & 0x40) !== 0;
    const frames = countByte & 0x3f;
    if (frames < 1 || frames > 48) return null;

    if (hasPadding) {
      let more = true;
      while (more) {
        if (cursor >= packetEnd) return null;
        const p = bytes[cursor]!; // bounds-checked above
        cursor += 1;
        if (p === 255) {
          padding += 254;
        } else {
          padding += p;
          more = false;
        }
      }
    }

    if (vbr) {
      const lengths: number[] = [];
      let sum = 0;
      for (let i = 0; i < frames - 1; i++) {
        const len = readFrameLength();
        if (len === null) return null;
        lengths.push(len);
        sum += len;
      }
      const last = packetEnd - cursor - padding - sum;
      if (last < 0) return null;
      lengths.push(last);
      frameCount = frames;
      frameLengths = lengths;
    } else {
      const dataLen = packetEnd - cursor - padding;
      if (dataLen < 0 || dataLen % frames !== 0) return null;
      frameCount = frames;
      frameLengths = new Array(frames).fill(dataLen / frames);
    }
  }

  const headerBytes = cursor - offset;
  const totalDataAndPadding = frameLengths.reduce((sum, len) => sum + len, 0) + padding;
  if (headerBytes + totalDataAndPadding !== length) return null; // must exactly account for the packet
  if (frameLengths.some((len) => len < 0 || len > 1275)) return null;

  const totalSamples = frameCount * frameSamples;
  if (totalSamples > MAX_PACKET_SAMPLES_48K) return null;
  return totalSamples;
}

type ParseState = {
  elementCount: number;
  blockCount: number;
  opusTrackNumber: number | null;
  timestampScaleNs: bigint;
  encodedSamples48k: number;
  firstStartNs: bigint | null;
  lastEndpointNs: bigint | null;
};

function bumpElementCount(state: ParseState): boolean {
  state.elementCount += 1;
  return state.elementCount <= MAX_ELEMENTS;
}

function currentMeasuredMs(state: ParseState): number {
  const encodedMs = state.encodedSamples48k / 48;
  const timelineMs =
    state.firstStartNs !== null && state.lastEndpointNs !== null
      ? Number(state.lastEndpointNs - state.firstStartNs) / 1_000_000
      : 0;
  return Math.max(encodedMs, timelineMs);
}

/** Parses Tracks content; requires exactly one TrackEntry, audio, codec A_OPUS. Returns its track number or null. */
function parseTracks(bytes: Uint8Array, start: number, end: number, state: ParseState): number | null {
  let pos = start;
  let trackEntryCount = 0;
  let opusTrackNumber: number | null = null;

  while (pos < end) {
    if (!bumpElementCount(state)) return null;
    const header = readElementHeader(bytes, pos, end);
    if (!header || header.unknown) return null;
    if (header.contentStart + header.size > end) return null;
    if (header.id !== ID_TRACK_ENTRY) return null; // narrow profile: Tracks holds only TrackEntry

    trackEntryCount += 1;
    if (trackEntryCount > 1) return null; // multiple tracks unsupported

    const entryResult = parseTrackEntry(bytes, header.contentStart, header.contentStart + header.size, state);
    if (entryResult === null) return null;
    opusTrackNumber = entryResult;

    pos = header.contentStart + header.size;
  }

  if (trackEntryCount !== 1 || opusTrackNumber === null) return null;
  return opusTrackNumber;
}

function parseTrackEntry(bytes: Uint8Array, start: number, end: number, state: ParseState): number | null {
  let pos = start;
  let trackNumber: number | null = null;
  let trackType: number | null = null;
  let codecId: string | null = null;

  while (pos < end) {
    if (!bumpElementCount(state)) return null;
    const header = readElementHeader(bytes, pos, end);
    if (!header || header.unknown) return null;
    if (header.contentStart + header.size > end) return null;

    if (header.id === ID_TRACK_NUMBER) {
      trackNumber = readUintContent(bytes, header.contentStart, header.size, end);
      if (trackNumber === null || trackNumber < 1) return null;
    } else if (header.id === ID_TRACK_TYPE) {
      trackType = readUintContent(bytes, header.contentStart, header.size, end);
      if (trackType === null) return null;
    } else if (header.id === ID_CODEC_ID) {
      codecId = readAsciiContent(bytes, header.contentStart, header.size, end);
      if (codecId === null) return null;
    }
    // Every other TrackEntry child (Audio, Name, Language, ...) is skipped by size; unneeded for duration.

    pos = header.contentStart + header.size;
  }

  if (trackNumber === null || trackType === null || codecId === null) return null;
  if (trackType === TRACK_TYPE_VIDEO) return null;
  if (trackType !== TRACK_TYPE_AUDIO) return null;
  if (codecId !== OPUS_CODEC_ID) return null;

  return trackNumber;
}

function parseInfo(bytes: Uint8Array, start: number, end: number, state: ParseState): boolean {
  let pos = start;
  let sawTimestampScale = false;

  while (pos < end) {
    if (!bumpElementCount(state)) return false;
    const header = readElementHeader(bytes, pos, end);
    if (!header || header.unknown) return false;
    if (header.contentStart + header.size > end) return false;

    if (header.id === ID_TIMESTAMP_SCALE) {
      if (sawTimestampScale) return false; // ambiguous duplicate
      const scale = readUintContent(bytes, header.contentStart, header.size, end);
      if (scale === null || scale < 1) return false;
      state.timestampScaleNs = BigInt(scale);
      sawTimestampScale = true;
    }
    // Duration and every other Info child is intentionally unparsed: this
    // fallback only runs when the caller already found no usable duration.

    pos = header.contentStart + header.size;
  }

  return true;
}

/** Processes one SimpleBlock. Returns false to reject the whole file. */
function processSimpleBlock(
  bytes: Uint8Array,
  contentStart: number,
  contentEnd: number,
  clusterTimestamp: bigint | null,
  state: ParseState,
): boolean {
  state.blockCount += 1;
  if (state.blockCount > MAX_BLOCKS) return false;
  if (clusterTimestamp === null) return false; // SimpleBlock before Cluster Timestamp: unsupported ordering

  const trackVint = readVint(bytes, contentStart, false, contentEnd);
  if (!trackVint || trackVint.unknown) return false;
  if (state.opusTrackNumber === null || trackVint.value !== state.opusTrackNumber) return false; // unknown/wrong track

  const relPos = contentStart + trackVint.length;
  if (relPos + 3 > contentEnd) return false; // needs 2 bytes timestamp + 1 byte flags
  const relRaw = (bytes[relPos]! << 8) | bytes[relPos + 1]!; // bounds-checked above
  const relTimestamp = relRaw >= 0x8000 ? relRaw - 0x10000 : relRaw;
  const flags = bytes[relPos + 2]!; // bounds-checked above
  const lacing = (flags >> 1) & 0x03;
  if (lacing !== 0) return false; // laced SimpleBlock unsupported

  const packetStart = relPos + 3;
  const packetLength = contentEnd - packetStart;
  if (packetLength < 1) return false;

  const totalSamples = parseOpusPacketSamples(bytes, packetStart, packetLength);
  if (totalSamples === null) return false;

  const absoluteTicks = clusterTimestamp + BigInt(relTimestamp);
  if (absoluteTicks < 0n) return false;

  const absoluteNs = absoluteTicks * state.timestampScaleNs;
  if (absoluteNs < 0n || absoluteNs > MAX_PLAUSIBLE_NS) return false;

  const blockDurationNs = (BigInt(totalSamples) * 1_000_000_000n) / 48_000n;
  const endpointNs = absoluteNs + blockDurationNs;
  if (endpointNs > MAX_PLAUSIBLE_NS) return false;

  state.encodedSamples48k += totalSamples;
  if (!Number.isSafeInteger(state.encodedSamples48k)) return false;

  if (state.firstStartNs === null || absoluteNs < state.firstStartNs) state.firstStartNs = absoluteNs;
  if (state.lastEndpointNs === null || endpointNs > state.lastEndpointNs) state.lastEndpointNs = endpointNs;

  return true;
}

/** Walks one Cluster's children (known- or unknown-size) starting at header.contentStart. Returns the offset the cluster ends at, or null to reject. */
function parseCluster(
  bytes: Uint8Array,
  header: ElementHeader,
  segmentEnd: number,
  state: ParseState,
): number | null {
  const hardEnd = header.unknown ? segmentEnd : header.contentStart + header.size;
  if (hardEnd > segmentEnd) return null;

  let pos = header.contentStart;
  let clusterTimestamp: bigint | null = null;

  while (true) {
    if (!header.unknown && pos >= hardEnd) break;
    if (pos >= segmentEnd) break;

    const peekId = readVint(bytes, pos, true, segmentEnd);
    if (!peekId) return null;

    if (header.unknown) {
      if (peekId.value === ID_CLUSTER || SEGMENT_LEVEL_IDS.has(peekId.value)) {
        break; // implicit end of an unknown-size Cluster
      }
      if (!CLUSTER_CHILD_IDS.has(peekId.value)) return null; // unrecognized structure while scanning
    }

    if (!bumpElementCount(state)) return null;
    const child = readElementHeader(bytes, pos, hardEnd);
    if (!child) return null;

    if (child.id === ID_BLOCK_GROUP) return null; // BlockGroup/Block unsupported: fail closed

    if (child.unknown) return null; // only Segment/Cluster may be unknown-size

    if (child.contentStart + child.size > hardEnd) return null;

    if (child.id === ID_CLUSTER_TIMESTAMP) {
      if (clusterTimestamp !== null) return null; // duplicate Timestamp: ambiguous
      const value = readUintContent(bytes, child.contentStart, child.size, hardEnd);
      if (value === null || value < 0) return null;
      clusterTimestamp = BigInt(value);
    } else if (child.id === ID_SIMPLE_BLOCK) {
      const ok = processSimpleBlock(bytes, child.contentStart, child.contentStart + child.size, clusterTimestamp, state);
      if (!ok) return null;
      if (currentMeasuredMs(state) > teamVoiceMaxDurationMs) {
        return child.contentStart + child.size; // stop early: already over cap, caller will reject
      }
    }
    // Position / PrevSize / SilentTracks: recognized, intentionally skipped.

    pos = child.contentStart + child.size;
  }

  return pos;
}

function parseSegmentBody(bytes: Uint8Array, start: number, end: number, state: ParseState): boolean {
  let pos = start;
  let sawInfo = false;
  let sawTracks = false;

  while (pos < end) {
    if (!bumpElementCount(state)) return false;
    const header = readElementHeader(bytes, pos, end);
    if (!header) return false;

    if (header.id === ID_INFO) {
      if (header.unknown || header.contentStart + header.size > end) return false;
      if (sawInfo) return false;
      sawInfo = true;
      if (!parseInfo(bytes, header.contentStart, header.contentStart + header.size, state)) return false;
      pos = header.contentStart + header.size;
    } else if (header.id === ID_TRACKS) {
      if (header.unknown || header.contentStart + header.size > end) return false;
      if (sawTracks) return false;
      sawTracks = true;
      const trackNumber = parseTracks(bytes, header.contentStart, header.contentStart + header.size, state);
      if (trackNumber === null) return false;
      state.opusTrackNumber = trackNumber;
      pos = header.contentStart + header.size;
    } else if (header.id === ID_CLUSTER) {
      if (!sawInfo || !sawTracks) return false; // Cluster before Info/Tracks: cannot validate scale/track references
      const clusterEnd = parseCluster(bytes, header, end, state);
      if (clusterEnd === null) return false;
      pos = clusterEnd;
      if (currentMeasuredMs(state) > teamVoiceMaxDurationMs) break; // stop early
    } else if (SEGMENT_LEVEL_IDS.has(header.id)) {
      if (header.unknown || header.contentStart + header.size > end) return false; // cannot safely skip an unknown-size element we don't parse
      pos = header.contentStart + header.size;
    } else {
      return false; // unrecognized Segment-level structure
    }
  }

  return sawInfo && sawTracks;
}

export function deriveWebmOpusDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 1 || bytes.length > teamVoiceMaxBytes) return null;

  const state: ParseState = {
    elementCount: 0,
    blockCount: 0,
    opusTrackNumber: null,
    timestampScaleNs: DEFAULT_TIMESTAMP_SCALE_NS,
    encodedSamples48k: 0,
    firstStartNs: null,
    lastEndpointNs: null,
  };

  const headerElement = readElementHeader(bytes, 0, bytes.length);
  if (!headerElement || headerElement.id !== ID_EBML_HEADER || headerElement.unknown) return null;
  if (headerElement.contentStart + headerElement.size > bytes.length) return null;

  const segmentPos = headerElement.contentStart + headerElement.size;
  const segmentHeader = readElementHeader(bytes, segmentPos, bytes.length);
  if (!segmentHeader || segmentHeader.id !== ID_SEGMENT) return null;

  const segmentEnd = segmentHeader.unknown
    ? bytes.length
    : segmentHeader.contentStart + segmentHeader.size;
  if (segmentEnd > bytes.length) return null;

  const ok = parseSegmentBody(bytes, segmentHeader.contentStart, segmentEnd, state);
  if (!ok) return null;
  if (state.blockCount < 1) return null;

  const measuredMs = currentMeasuredMs(state);
  if (!Number.isFinite(measuredMs) || measuredMs <= 0) return null;

  return Math.ceil(measuredMs);
}

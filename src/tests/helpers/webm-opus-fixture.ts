/**
 * Byte-accurate synthetic WebM/Opus fixture builder used only by tests.
 * Constructs the exact narrow EBML -> Segment -> Info/Tracks -> Cluster ->
 * SimpleBlock shape that src/lib/team-voice/webm-opus-duration.ts parses,
 * so tests exercise real bytes rather than a mocked numeric duration.
 */

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** EBML vint: marker-bit length prefix + data bits. Used for element sizes and the Block-header track number field. */
function encodeVint(value: number): Uint8Array {
  let length = 1;
  while (value > 2 ** (7 * length) - 2 && length < 8) length++;
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  bytes[0] = (bytes[0] ?? 0) | (0x80 >> (length - 1));
  return bytes;
}

type UnknownSizeLength = 1 | 8;

function unknownSizeVint(length: UnknownSizeLength): Uint8Array {
  const bytes = new Uint8Array(length).fill(0xff);
  const marker = 0x80 >> (length - 1);
  bytes[0] = marker | (marker - 1);
  return bytes;
}

/** Plain big-endian unsigned integer content (no vint marker) used for element values. */
function uintBytes(value: number, length = 1): Uint8Array {
  let len = length;
  while (value >= 2 ** (8 * len) && len < 8) len++;
  const bytes = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return bytes;
}

function asciiBytes(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

function el(
  id: number[],
  content: Uint8Array,
  opts: { unknownSize?: boolean; unknownSizeLength?: UnknownSizeLength } = {},
): Uint8Array {
  const sizeBytes = opts.unknownSize
    ? unknownSizeVint(opts.unknownSizeLength ?? 1)
    : encodeVint(content.length);
  return concatBytes([new Uint8Array(id), sizeBytes, content]);
}

export const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  DOC_TYPE: [0x42, 0x82],
  SEGMENT: [0x18, 0x53, 0x80, 0x67],
  INFO: [0x15, 0x49, 0xa9, 0x66],
  TIMESTAMP_SCALE: [0x2a, 0xd7, 0xb1],
  DURATION: [0x44, 0x89],
  TRACKS: [0x16, 0x54, 0xae, 0x6b],
  TRACK_ENTRY: [0xae],
  TRACK_NUMBER: [0xd7],
  TRACK_TYPE: [0x83],
  TRACK_TIMESTAMP_SCALE: [0x23, 0x31, 0x4f],
  CODEC_ID: [0x86],
  AUDIO: [0xe1],
  SAMPLING_FREQUENCY: [0xb5],
  CHANNELS: [0x9f],
  CLUSTER: [0x1f, 0x43, 0xb6, 0x75],
  CLUSTER_TIMESTAMP: [0xe7],
  SIMPLE_BLOCK: [0xa3],
  BLOCK_GROUP: [0xa0],
  BLOCK: [0xa1],
};

export function ebmlHeader(): Uint8Array {
  return el(ID.EBML, el(ID.DOC_TYPE, asciiBytes("webm")));
}

export function info(
  opts: {
    timestampScaleNs?: number;
    durationMs?: number;
    omitTimestampScale?: boolean;
    extraChildren?: Uint8Array[];
  } = {},
): Uint8Array {
  const parts: Uint8Array[] = [];
  if (!opts.omitTimestampScale) {
    parts.push(el(ID.TIMESTAMP_SCALE, uintBytes(opts.timestampScaleNs ?? 1_000_000, 4)));
  }
  if (opts.durationMs !== undefined) {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, opts.durationMs, false);
    parts.push(el(ID.DURATION, buf));
  }
  if (opts.extraChildren) parts.push(...opts.extraChildren);
  return el(ID.INFO, concatBytes(parts));
}

export function audioSettings(opts: { samplingFrequency?: number; channels?: number } = {}): Uint8Array {
  const freqBuf = new Uint8Array(4);
  new DataView(freqBuf.buffer).setFloat32(0, opts.samplingFrequency ?? 48_000, false);
  const parts = [
    el(ID.SAMPLING_FREQUENCY, freqBuf),
    el(ID.CHANNELS, uintBytes(opts.channels ?? 1, 1)),
  ];
  return el(ID.AUDIO, concatBytes(parts));
}

export function trackEntry(
  opts: {
    trackNumber?: number;
    trackType?: number;
    codecId?: string;
    trackTimestampScale?: number;
    audio?: Uint8Array;
    extraChildren?: Uint8Array[];
  } = {},
): Uint8Array {
  const parts: Uint8Array[] = [];
  if (opts.trackNumber !== undefined) parts.push(el(ID.TRACK_NUMBER, uintBytes(opts.trackNumber, 1)));
  if (opts.trackType !== undefined) parts.push(el(ID.TRACK_TYPE, uintBytes(opts.trackType, 1)));
  if (opts.codecId !== undefined) parts.push(el(ID.CODEC_ID, asciiBytes(opts.codecId)));
  if (opts.trackTimestampScale !== undefined) {
    const scale = new Uint8Array(8);
    new DataView(scale.buffer).setFloat64(0, opts.trackTimestampScale, false);
    parts.push(el(ID.TRACK_TIMESTAMP_SCALE, scale));
  }
  if (opts.audio) parts.push(opts.audio);
  if (opts.extraChildren) parts.push(...opts.extraChildren);
  return el(ID.TRACK_ENTRY, concatBytes(parts));
}

export function trackNumberElement(value: number): Uint8Array {
  return el(ID.TRACK_NUMBER, uintBytes(value));
}

export function trackTypeElement(value: number): Uint8Array {
  return el(ID.TRACK_TYPE, uintBytes(value));
}

export function codecIdElement(value: string): Uint8Array {
  return el(ID.CODEC_ID, asciiBytes(value));
}

export function trackTimestampScaleElement(value: number): Uint8Array {
  const scale = new Uint8Array(8);
  new DataView(scale.buffer).setFloat64(0, value, false);
  return el(ID.TRACK_TIMESTAMP_SCALE, scale);
}

export function opusTrackEntry(trackNumber = 1): Uint8Array {
  return trackEntry({ trackNumber, trackType: 2, codecId: "A_OPUS", audio: audioSettings() });
}

export function tracks(entries: Uint8Array[]): Uint8Array {
  return el(ID.TRACKS, concatBytes(entries));
}

/** Opus TOC config indices used by these fixtures (see RFC 6716 Table 2). */
export const OPUS_CONFIG_60MS_SILK_NB = 3;
export const OPUS_CONFIG_20MS_CELT_NB = 19;

/** code=0: a single frame occupying the rest of the packet. */
export function opusPacketSingleFrame(config: number, frameLength = 8): Uint8Array {
  const toc = (config << 3) | 0x00;
  const frame = new Uint8Array(frameLength).fill(0x11);
  return concatBytes([new Uint8Array([toc]), frame]);
}

/** code=1: two equal-size frames, no explicit length field. */
export function opusPacketTwoFrames(config: number, frameLength = 8): Uint8Array {
  const toc = (config << 3) | 0x01;
  const frame = new Uint8Array(frameLength * 2).fill(0x22);
  return concatBytes([new Uint8Array([toc]), frame]);
}

/** code=1 with an odd remaining-byte count: malformed (two equal frames must split evenly). */
export function malformedOddSplitOpusPacket(config: number): Uint8Array {
  const toc = (config << 3) | 0x01;
  return new Uint8Array([toc, 0x00, 0x00, 0x00]);
}

/** code=3, CBR (vbr=0), no padding: `frameCount` equal-size frames. */
export function opusPacketCode3Cbr(config: number, frameCount: number, frameLength = 4): Uint8Array {
  const toc = (config << 3) | 0x03;
  const countByte = frameCount & 0x3f;
  const frames = new Uint8Array(frameLength * frameCount).fill(0x33);
  return concatBytes([new Uint8Array([toc, countByte]), frames]);
}

/** code=3, CBR, frame count that does not evenly divide the remaining bytes: malformed. */
export function malformedCbrFrameCountOpusPacket(config: number): Uint8Array {
  const toc = (config << 3) | 0x03;
  const countByte = 5; // vbr=0, padding=0, frames=5
  const frames = new Uint8Array(17).fill(0x44); // 17 is not divisible by 5
  return concatBytes([new Uint8Array([toc, countByte]), frames]);
}

/** code=3 with the padding flag set but no packet bytes left to hold the padding-length field: malformed/truncated. */
export function malformedTruncatedPaddingOpusPacket(config: number): Uint8Array {
  const toc = (config << 3) | 0x03;
  const countByte = 0x40 | 3; // padding=1, vbr=0, frames=3
  return new Uint8Array([toc, countByte]);
}

export function simpleBlock(
  trackNumber: number,
  relativeTimestamp: number,
  packet: Uint8Array,
  opts: { lacing?: number } = {},
): Uint8Array {
  const trackVint = encodeVint(trackNumber);
  const tsBytes = new Uint8Array(2);
  new DataView(tsBytes.buffer).setInt16(0, relativeTimestamp, false);
  const flags = new Uint8Array([((opts.lacing ?? 0) << 1) & 0x06]);
  const content = concatBytes([trackVint, tsBytes, flags, packet]);
  return el(ID.SIMPLE_BLOCK, content);
}

export function blockGroupWithBlock(trackNumber: number, relativeTimestamp: number, packet: Uint8Array): Uint8Array {
  return el(ID.BLOCK_GROUP, block(trackNumber, relativeTimestamp, packet));
}

export function block(trackNumber: number, relativeTimestamp: number, packet: Uint8Array): Uint8Array {
  const trackVint = encodeVint(trackNumber);
  const tsBytes = new Uint8Array(2);
  new DataView(tsBytes.buffer).setInt16(0, relativeTimestamp, false);
  const flags = new Uint8Array([0]);
  const blockContent = concatBytes([trackVint, tsBytes, flags, packet]);
  return el(ID.BLOCK, blockContent);
}

export function cluster(
  timestamp: number,
  blocks: Uint8Array[],
  opts: { unknownSize?: boolean; unknownSizeLength?: UnknownSizeLength } = {},
): Uint8Array {
  const content = concatBytes([el(ID.CLUSTER_TIMESTAMP, uintBytes(timestamp, 4)), ...blocks]);
  return el(ID.CLUSTER, content, opts);
}

export function segment(
  children: Uint8Array[],
  opts: { unknownSize?: boolean; unknownSizeLength?: UnknownSizeLength } = {},
): Uint8Array {
  return el(ID.SEGMENT, concatBytes(children), opts);
}

export function webmFile(
  children: Uint8Array[],
  opts: { segmentUnknownSize?: boolean; segmentUnknownSizeLength?: UnknownSizeLength } = {},
): Uint8Array {
  return concatBytes([
    ebmlHeader(),
    segment(children, {
      unknownSize: opts.segmentUnknownSize ?? true,
      unknownSizeLength: opts.segmentUnknownSizeLength,
    }),
  ]);
}

/**
 * Lays out `totalBlocks` uniform-duration SimpleBlocks sequentially in time
 * (no gaps) and chunks them into as many clusters as needed to keep every
 * relative timestamp within the signed int16 range.
 */
export function buildUniformClusters(
  totalBlocks: number,
  durationTicksPerBlock: number,
  packetFactory: (index: number) => Uint8Array,
  trackNumber = 1,
  opts: { unknownSize?: boolean; relativeTimestamp?: number } = {},
): Uint8Array[] {
  const maxSpanTicks = 20_000;
  const blocksPerCluster = Math.max(1, Math.floor(maxSpanTicks / durationTicksPerBlock));
  const clusters: Uint8Array[] = [];
  let index = 0;
  let absoluteTicks = 0;

  while (index < totalBlocks) {
    const clusterBase = absoluteTicks;
    const blocks: Uint8Array[] = [];
    for (let i = 0; i < blocksPerCluster && index < totalBlocks; i++, index++) {
      const rel = opts.relativeTimestamp ?? absoluteTicks - clusterBase;
      blocks.push(simpleBlock(trackNumber, rel, packetFactory(index)));
      absoluteTicks += durationTicksPerBlock;
    }
    clusters.push(cluster(clusterBase, blocks, { unknownSize: opts.unknownSize }));
  }
  return clusters;
}

/**
 * The narrow "Chrome MediaRecorder" shape confirmed in KI-058's byte-level
 * experiment: unknown-size Segment, Info with TimestampScale but no
 * Duration, Tracks with a single A_OPUS track, unknown-size Cluster(s) of
 * SimpleBlocks. Each block is 120ms (two 60ms Opus frames via code=1).
 */
export function chromeStyleFixture(
  totalMs: number,
  opts: { trackNumber?: number; clusterUnknownSize?: boolean; segmentUnknownSize?: boolean } = {},
): Uint8Array {
  const trackNumber = opts.trackNumber ?? 1;
  const msPerBlock = 120;
  const blockCount = Math.round(totalMs / msPerBlock);
  const clusters = buildUniformClusters(
    blockCount,
    msPerBlock, // 1ms per tick (default TimestampScale) => ticks == ms
    () => opusPacketTwoFrames(OPUS_CONFIG_60MS_SILK_NB, 10),
    trackNumber,
    { unknownSize: opts.clusterUnknownSize ?? true },
  );
  return webmFile([info(), tracks([opusTrackEntry(trackNumber)]), ...clusters], {
    segmentUnknownSize: opts.segmentUnknownSize ?? true,
  });
}

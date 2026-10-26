import { TICKET_ATTACHMENT_MAX_BYTES, TICKET_AUDIO_MAX_DURATION_MS } from "./ticket-attachment-file";

function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length || packet.length > 61_440) throw new Error("Invalid Opus packet size");
  const toc = packet[0]!;
  const config = toc >> 3;
  const frameSamples = config >= 16 ? 120 * (1 << (config & 3))
    : config >= 12 ? 480 * (1 << (config & 1)) : (config & 3) === 3 ? 2880 : 480 * (1 << (config & 3));
  const code = toc & 3;
  let cursor = 1;
  let end = packet.length;
  let frames = code === 0 ? 1 : 2;
  const frameSize = (length: number) => {
    if (length < 0 || length > 1275) throw new Error("Invalid Opus frame length");
  };
  const length = () => {
    if (cursor >= end) throw new Error("Truncated Opus frame length");
    const first = packet[cursor++]!;
    if (first < 252) return first;
    if (cursor >= end) throw new Error("Truncated Opus frame length");
    return first + 4 * packet[cursor++]!;
  };
  if (code === 0) frameSize(end - cursor);
  else if (code === 1) {
    if ((end - cursor) % 2) throw new Error("Invalid Opus CBR framing");
    frameSize((end - cursor) / 2);
  } else if (code === 2) {
    const first = length();
    frameSize(first);
    frameSize(end - cursor - first);
  } else {
    if (cursor >= end) throw new Error("Truncated Opus packet control");
    const control = packet[cursor++]!;
    frames = control & 63;
    if (!frames || frames * frameSamples > 5760) throw new Error("Invalid Opus packet duration");
    if (control & 64) {
      let padding = 0;
      let value: number;
      do {
        if (cursor >= end) throw new Error("Truncated Opus padding");
        value = packet[cursor++]!;
        padding += value === 255 ? 254 : value;
      } while (value === 255);
      if (padding > end - cursor) throw new Error("Invalid Opus padding");
      end -= padding;
    }
    if (control & 128) {
      let used = 0;
      for (let frame = 1; frame < frames; frame++) {
        const size = length();
        frameSize(size);
        used += size;
      }
      frameSize(end - cursor - used);
    } else {
      if ((end - cursor) % frames) throw new Error("Invalid Opus CBR framing");
      frameSize((end - cursor) / frames);
    }
  }
  if (frames * frameSamples > 5760) throw new Error("Invalid Opus packet duration");
  return frames * frameSamples;
}

function verifyOpusTags(packet: Uint8Array) {
  if (packet.length < 16 || String.fromCharCode(...packet.subarray(0, 8)) !== "OpusTags") throw new Error("An Opus comment header is required");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let cursor = 12 + view.getUint32(8, true);
  if (cursor + 4 > packet.length) throw new Error("Invalid Opus comments");
  const comments = view.getUint32(cursor, true);
  cursor += 4;
  if (comments > (packet.length - cursor) / 4) throw new Error("Invalid Opus comments");
  for (let comment = 0; comment < comments; comment++) {
    if (cursor + 4 > packet.length) throw new Error("Invalid Opus comments");
    cursor += 4 + view.getUint32(cursor, true);
    if (cursor > packet.length) throw new Error("Invalid Opus comments");
  }
}

export function oggOpusDurationMs(bytes: Uint8Array): number {
  if (bytes.length > TICKET_ATTACHMENT_MAX_BYTES) throw new Error("Ogg recording exceeds the file limit");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unknownGranule = 0xffff_ffff_ffff_ffffn;
  let cursor = 0;
  let serial: number | null = null;
  let sequence = 0;
  let preSkip = 0;
  let granule = 0n;
  let continued = false;
  let ended = false;
  let headers = 0;
  let packetParts: Uint8Array[] = [];
  let packetSize = 0;
  let decodedSamples = 0;
  let lastPacketSamples = 0;
  let initialGranule: bigint | null = null;
  let audioPackets = 0;

  while (cursor < bytes.length) {
    if (sequence > 100_000 || cursor + 27 > bytes.length || ended) throw new Error("Invalid Ogg page");
    if (String.fromCharCode(...bytes.subarray(cursor, cursor + 4)) !== "OggS" || bytes[cursor + 4] !== 0) throw new Error("Invalid Ogg header");
    const flags = view.getUint8(cursor + 5);
    const pageGranule = view.getBigUint64(cursor + 6, true);
    const pageSerial = view.getUint32(cursor + 14, true);
    if (flags & ~7 || view.getUint32(cursor + 18, true) !== sequence || Boolean(flags & 1) !== continued) throw new Error("Invalid Ogg sequence");
    if (serial === null) serial = pageSerial;
    if (pageSerial !== serial || Boolean(flags & 2) !== (sequence === 0)) throw new Error("Only one Opus stream is supported");
    const segmentCount = view.getUint8(cursor + 26);
    const payload = cursor + 27 + segmentCount;
    if (payload > bytes.length) throw new Error("Truncated Ogg segment table");
    let size = 0;
    for (let i = cursor + 27; i < payload; i++) size += view.getUint8(i);
    const stop = payload + size;
    if (stop > bytes.length) throw new Error("Truncated Ogg payload");
    if (pageGranule !== unknownGranule) {
      if (pageGranule < granule || pageGranule > BigInt(preSkip + 300 * 48_000)) throw new Error("Invalid Opus granule duration");
    }
    if (flags & 4) {
      if (pageGranule === unknownGranule || stop !== bytes.length) throw new Error("Invalid Opus end-of-stream");
    }
    const previousAudioPackets = audioPackets;
    let packetCursor = payload;
    let headerPage = false;
    for (let segment = 0; segment < segmentCount; segment++) {
      const segmentSize = bytes[cursor + 27 + segment]!;
      packetParts.push(bytes.subarray(packetCursor, packetCursor + segmentSize));
      packetCursor += segmentSize;
      packetSize += segmentSize;
      if (packetSize > 61_440) throw new Error("Invalid Opus packet size");
      if (segmentSize === 255) continue;
      const packet = new Uint8Array(packetSize);
      let copied = 0;
      for (const part of packetParts) { packet.set(part, copied); copied += part.length; }
      packetParts = [];
      packetSize = 0;
      if (headers === 0) {
        if (sequence !== 0 || segment !== segmentCount - 1 || packet.length !== 19 ||
          String.fromCharCode(...packet.subarray(0, 8)) !== "OpusHead" ||
          packet[8] !== 1 || ![1, 2].includes(packet[9]!) || packet[18] !== 0 || pageGranule !== 0n) {
          throw new Error("An Opus identification packet is required");
        }
        preSkip = new DataView(packet.buffer).getUint16(10, true);
        headers++;
        headerPage = true;
      } else if (headers === 1) {
        verifyOpusTags(packet);
        if (segment !== segmentCount - 1 || pageGranule !== 0n) throw new Error("Invalid Opus header granule duration");
        headers++;
        headerPage = true;
      } else {
        if (++audioPackets > 120_010) throw new Error("Too many Opus packets");
        lastPacketSamples = opusPacketSamples(packet);
        decodedSamples += lastPacketSamples;
        if (decodedSamples > TICKET_AUDIO_MAX_DURATION_MS * 48 + preSkip + 5760) throw new Error("Invalid Opus packet duration");
      }
    }
    continued = packetParts.length > 0;
    if (sequence === 0 && (headers !== 1 || continued)) throw new Error("An Opus identification packet is required");
    if (audioPackets > previousAudioPackets) {
      if (pageGranule === unknownGranule) throw new Error("Invalid Opus granule duration");
      const decoded = BigInt(decodedSamples);
      if (initialGranule === null) {
        if (!(flags & 4) && pageGranule < decoded) throw new Error("Invalid Opus granule duration");
        initialGranule = pageGranule > decoded ? pageGranule - decoded : 0n;
      }
      const expected = initialGranule + decoded;
      // Bound end trimming to the final packet so granules cannot hide earlier encoded audio.
      if (flags & 4) {
        if (pageGranule > expected || expected - pageGranule > BigInt(lastPacketSamples)) throw new Error("Invalid Opus end trimming duration");
      } else if (pageGranule !== expected) throw new Error("Invalid Opus granule duration");
    } else if (!headerPage && pageGranule !== unknownGranule) throw new Error("Invalid Opus granule duration");
    if (pageGranule !== unknownGranule) granule = pageGranule;
    if (flags & 4) {
      if (continued || !audioPackets || audioPackets === previousAudioPackets) throw new Error("Invalid Opus end-of-stream");
      ended = true;
    }
    sequence++;
    cursor = stop;
  }
  if (!ended || headers !== 2 || !audioPackets || granule <= BigInt(preSkip)) throw new Error("Missing Opus audio end-of-stream");
  return Number(granule - BigInt(preSkip)) / 48;
}

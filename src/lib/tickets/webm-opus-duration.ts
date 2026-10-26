// MediaRecorder WebM lacks Segment duration; timestamps and Opus packet TOCs are in the bytes.
export function webmOpusDurationMs(bytes: Uint8Array): number {
  let elements = 0;
  let scale = 1_000_000;
  let endMs = 0;
  let blockCount = 0;
  let packetDurationMs = 0;

  function byte(offset: number) {
    const value = bytes[offset];
    if (value === undefined) throw new Error("Truncated WebM byte");
    return value;
  }

  function vint(offset: number, keepMarker = false) {
    const first = byte(offset);
    if (!first) throw new Error("Invalid EBML integer");
    let length = 1;
    while (length <= 8 && !(first & (1 << (8 - length)))) length++;
    if (length > 8 || offset + length > bytes.length || (keepMarker && length > 4)) throw new Error("Invalid EBML integer");
    let value = keepMarker ? first : first & ((1 << (8 - length)) - 1);
    let unknown = !keepMarker && value === (1 << (8 - length)) - 1;
    for (let i = 1; i < length; i++) { const next = byte(offset + i); value = value * 256 + next; unknown = unknown && next === 255; }
    if (!unknown && !Number.isSafeInteger(value)) throw new Error("Unsafe EBML integer");
    return { value, length, unknown };
  }

  function integer(start: number, end: number) {
    if (end - start > 6 || end <= start) throw new Error("Invalid timestamp");
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + byte(i);
    return value;
  }

  function block(start: number, end: number, cluster: number) {
    const track = vint(start);
    const position = start + track.length;
    if (position + 4 > end || byte(position + 2) & 6) throw new Error("Unsupported laced block");
    const relative = ((byte(position) << 8) | byte(position + 1)) << 16 >> 16;
    const packet = position + 3;
    const toc = byte(packet);
    const config = toc >> 3;
    const frameMs = config >= 16 ? 2.5 * (1 << (config & 3)) : config >= 12 ? 10 * (1 << (config & 1)) : (config & 3) === 3 ? 60 : 10 * (1 << (config & 3));
    const code = toc & 3;
    if (code === 3 && packet + 1 >= end) throw new Error("Truncated Opus packet");
    const frames = code === 0 ? 1 : code === 3 ? byte(packet + 1) & 63 : 2;
    const packetMs = frameMs * frames;
    if (!frames || packetMs > 120 || cluster + relative < 0) throw new Error("Invalid Opus timing");
    endMs = Math.max(endMs, (cluster + relative) * scale / 1_000_000 + packetMs);
    packetDurationMs += packetMs;
    blockCount++;
  }

  function walk(start: number, end: number, level = 0, cluster = 0, inCluster = false): number {
    if (level > 4) throw new Error("Invalid EBML nesting");
    let cursor = start;
    let timestamp = cluster;
    while (cursor < end) {
      if (++elements > 100_000) throw new Error("Too many EBML elements");
      const id = vint(cursor, true);
      if (inCluster && id.length === 4) return cursor;
      const size = vint(cursor + id.length);
      const data = cursor + id.length + size.length;
      const stop = size.unknown ? end : data + size.value;
      if (stop > end || stop <= cursor) throw new Error("Truncated EBML element");
      if (size.unknown && ![0x18538067, 0x1f43b675].includes(id.value)) throw new Error("Invalid EBML size");
      if (id.value === 0x18538067 || id.value === 0x1549a966 || id.value === 0x1f43b675 || id.value === 0xa0) {
        const parsedEnd = walk(data, stop, level + 1, id.value === 0x1f43b675 ? 0 : timestamp, id.value === 0x1f43b675);
        if (size.unknown && id.value === 0x1f43b675) { cursor = parsedEnd; continue; }
      } else if (id.value === 0x2ad7b1) {
        scale = integer(data, stop);
        if (scale < 1 || scale > 1_000_000_000) throw new Error("Invalid timestamp scale");
      } else if (id.value === 0xe7) timestamp = integer(data, stop);
      else if (id.value === 0xa3 || id.value === 0xa1) block(data, stop, timestamp);
      cursor = stop;
    }
    return cursor;
  }

  walk(0, bytes.length);
  if (!blockCount) throw new Error("No Opus audio blocks");
  return Math.max(endMs, packetDurationMs);
}

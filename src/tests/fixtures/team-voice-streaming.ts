const element = (id: number[], payload: number[]) => [...id, 0x80 | payload.length, ...payload];
const text = (value: string) => [...new TextEncoder().encode(value)];
function integer(value: number) {
  const result = [value & 255];
  while ((value = Math.floor(value / 256)) > 0) result.unshift(value & 255);
  return result;
}

export function streamingWebm(lastTimestamp = 16_000, flags = 0x80) {
  const sampling = new Uint8Array(8);
  new DataView(sampling.buffer).setFloat64(0, 48_000);
  const opusHead = [...text("OpusHead"), 1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0];
  const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], text("webm")));
  const entry = element([0xae], [
    ...element([0xd7], [1]), ...element([0x73, 0xc5], [1]), ...element([0x83], [2]),
    ...element([0x86], text("A_OPUS")), ...element([0x63, 0xa2], opusHead),
    ...element([0xe1], [...element([0xb5], [...sampling]), ...element([0x9f], [1])]),
  ]);
  const tracks = element([0x16, 0x54, 0xae, 0x6b], entry);
  const cluster = (timestamp: number) => element([0x1f, 0x43, 0xb6, 0x75], [
    ...element([0xe7], integer(timestamp)),
    ...element([0xa3], [0x81, 0, 0, flags, 0xf8, 0xff, 0xfe]),
  ]);
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, 0xff, ...tracks, ...cluster(0), ...cluster(lastTimestamp)]);
}

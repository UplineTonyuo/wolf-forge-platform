import { describe, expect, it } from "vitest";
import { oggOpusDurationMs } from "../lib/tickets/ogg-opus-duration";
import { validateTicketVoiceFile } from "../lib/tickets/ticket-voice-file";

const text = (value: string) => new TextEncoder().encode(value);
const head = new Uint8Array([...text("OpusHead"), 1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]);
const tags = new Uint8Array([...text("OpusTags"), 0, 0, 0, 0, 0, 0, 0, 0]);
function page(payload: Uint8Array, sequence: number, granule: number, flags: number, serial = 42, lacing?: number[]) {
  const segments = lacing ?? [...Array.from({ length: Math.floor(payload.length / 255) }, () => 255), payload.length % 255];
  const result = new Uint8Array(27 + segments.length + payload.length);
  result.set(text("OggS")); result[5] = flags;
  const view = new DataView(result.buffer);
  view.setBigUint64(6, BigInt(granule), true); view.setUint32(14, serial, true); view.setUint32(18, sequence, true);
  result[26] = segments.length; result.set(segments, 27); result.set(payload, 27 + segments.length);
  return result;
}
const combine = (...pages: Uint8Array[]) => new Uint8Array(pages.flatMap((item) => [...item]));
const fixture = () => combine(page(head, 0, 0, 2), page(tags, 1, 0, 0), page(new Uint8Array([0xf8, 0xff, 0xfe]), 2, 1272, 4));
const stream = (packets: number[][], finalGranule: number) => combine(
  page(head, 0, 0, 2), page(tags, 1, 0, 0),
  page(new Uint8Array(packets.flat()), 2, finalGranule, 4, 42, packets.map((packet) => packet.length)),
);

describe("single-stream Ogg Opus gate", () => {
  it("measures a valid completed stream and accepts it through the real installed metadata parser", async () => {
    const bytes = fixture();
    expect(oggOpusDurationMs(bytes)).toBe(20);
    expect(await validateTicketVoiceFile(new File([bytes], "voice.ogg", { type: "audio/ogg" }), bytes)).toMatchObject({ ok: true, mimeType: "audio/ogg", durationMs: 20 });
  });
  it("rejects another serial, including a multiplexed video logical stream", () => {
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(text("theora"), 1, 0, 0, 43)))).toThrow("one Opus stream");
  });
  it("requires OpusHead and refuses nonzero Ogg versions", () => {
    expect(() => oggOpusDurationMs(page(new Uint8Array(19), 0, 0, 2))).toThrow("identification");
    const bytes = fixture(); bytes[4] = 1;
    expect(() => oggOpusDurationMs(bytes)).toThrow("header");
  });
  it("rejects missing EOS, trailing/chained streams and out-of-order pages", () => {
    expect(() => oggOpusDurationMs(page(head, 0, 0, 2))).toThrow("end-of-stream");
    expect(() => oggOpusDurationMs(combine(fixture(), page(head, 0, 0, 2, 43)))).toThrow("end-of-stream");
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 2, 0, 0)))).toThrow("sequence");
  });
  it("rejects oversized/backward granules and unknown EOS granules", () => {
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 1, 14_500_000, 4)))).toThrow("duration");
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 1, 500, 0), page(tags, 2, 400, 4)))).toThrow("duration");
    const bytes = fixture(); bytes.fill(255, bytes.length - 31 + 6, bytes.length - 31 + 14);
    expect(() => oggOpusDurationMs(bytes)).toThrow("end-of-stream");
  });
  it("rejects truncated page headers, segment tables and payloads", () => {
    for (const bytes of [fixture().subarray(0, 15), fixture().subarray(0, 27), fixture().subarray(0, 30)]) {
      expect(() => oggOpusDurationMs(bytes)).toThrow();
    }
    const bytes = fixture(); bytes[26] = 255;
    expect(() => oggOpusDurationMs(bytes)).toThrow("segment table");
  });

  it("rejects many encoded packets hidden behind one tiny final granule", async () => {
    const bytes = stream(Array.from({ length: 200 }, () => [0xf8, 0xff, 0xfe]), 1272);
    expect(() => oggOpusDurationMs(bytes)).toThrow("end trimming duration");
    expect(await validateTicketVoiceFile(new File([bytes], "forged.ogg", { type: "audio/ogg" }), bytes)).toMatchObject({ ok: false });
  });

  it("rejects forged granules on an intermediate page, not only EOS", () => {
    expect(() => oggOpusDurationMs(combine(
      page(head, 0, 0, 2), page(tags, 1, 0, 0),
      page(new Uint8Array([0xf8, 0xff, 0xfe]), 2, 960, 0),
      page(new Uint8Array([0xf8, 0xff, 0xfe]), 3, 1000, 0),
      page(new Uint8Array([0xf8, 0xff, 0xfe]), 4, 2880, 4),
    ))).toThrow("granule duration");
  });

  it("preserves legitimate Opus pre-skip and final-packet trimming", () => {
    expect(oggOpusDurationMs(stream([[0xf8, 0xff, 0xfe], [0xf8, 0xff, 0xfe]], 1272))).toBe(20);
  });

  it.each([
    [[0xf8, 1], 20],
    [[0xf9, 1, 2], 40],
    [[0xfa, 1, 1, 2], 40],
    [[0xfb, 3, 1, 2, 3], 60],
    [[0xfb, 0x83, 1, 1, 1, 2, 3], 60],
    [[0xfb, 0x43, 1, 1, 2, 3, 0], 60],
    [[0x83, 48], 120],
  ])("counts valid Opus frame-packing packet %j", (packet, durationMs) => {
    expect(oggOpusDurationMs(stream([packet as number[]], 312 + Number(durationMs) * 48))).toBe(durationMs);
  });

  it.each([
    [], [0xf9, 1], [0xfa], [0xfa, 252], [0xfa, 3, 1],
    [0xfb], [0xfb, 0], [0xfb, 7], [0xfb, 0x43, 255],
    [0xfb, 0x43, 4, 1, 2], [0xfb, 0x83, 252], [0xfb, 0x83, 3, 3, 1],
  ].map((packet) => ({ packet })))("rejects malformed Opus packet framing $packet", ({ packet }) => {
    expect(() => oggOpusDurationMs(stream([packet], 1272))).toThrow();
  });

  it("rejects single frames larger than the Opus 1275-byte limit", () => {
    const packet = new Uint8Array(1277); packet[0] = 0xf8;
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 1, 0, 0), page(packet, 2, 1272, 4)))).toThrow("frame length");
  });

  it("reassembles and validates an Opus packet split across Ogg pages", () => {
    const packet = new Uint8Array(301); packet[0] = 0xf8;
    const first = page(packet.subarray(0, 255), 2, 0, 0, 42, [255]);
    new DataView(first.buffer).setBigUint64(6, 0xffff_ffff_ffff_ffffn, true);
    const last = page(packet.subarray(255), 3, 1272, 5);
    expect(oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 1, 0, 0), first, last))).toBe(20);
    last[5] = 4;
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(tags, 1, 0, 0), first, last))).toThrow("sequence");
  });

  it("requires a valid comment packet and mono/stereo Opus mapping", () => {
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(text("not-tags"), 1, 0, 0)))).toThrow("comment");
    const invalidHead = head.slice(); invalidHead[18] = 1;
    expect(() => oggOpusDurationMs(page(invalidHead, 0, 0, 2))).toThrow("identification");
    const invalidTags = tags.slice(); new DataView(invalidTags.buffer).setUint32(8, 500, true);
    expect(() => oggOpusDurationMs(combine(page(head, 0, 0, 2), page(invalidTags, 1, 0, 0)))).toThrow("comments");
  });

  it("rejects more than five minutes of packet audio even with a forged short EOS", () => {
    const pages = [page(head, 0, 0, 2), page(tags, 1, 0, 0)];
    for (let index = 0; index < 11; index++) {
      pages.push(page(new Uint8Array(Array.from({ length: 250 }, () => [0xfb, 6]).flat()), index + 2, 1272, index === 10 ? 4 : 0, 42, Array.from({ length: 250 }, () => 2)));
    }
    expect(() => oggOpusDurationMs(combine(...pages))).toThrow("duration");
  });

  it("accepts the five-minute boundary with legitimate final-frame padding", () => {
    const pages = [page(head, 0, 0, 2), page(tags, 1, 0, 0)];
    for (let index = 0; index < 60; index++) {
      pages.push(page(new Uint8Array(Array.from({ length: 250 }, () => [0xf8, 0xff, 0xfe]).flat()), index + 2, (index + 1) * 250 * 960, 0, 42, Array.from({ length: 250 }, () => 3)));
    }
    pages.push(page(new Uint8Array([0xf8, 0xff, 0xfe]), 62, 14_400_312, 4));
    expect(oggOpusDurationMs(combine(...pages))).toBe(300_000);
  });
});

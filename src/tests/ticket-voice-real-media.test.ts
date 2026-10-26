import { expect, it } from "vitest";
import { validateTicketVoiceFile } from "../lib/tickets/ticket-voice-file";
const element = (id: number[], payload: number[]) => [...id, 0x80 | payload.length, ...payload];
  it("accepts an audio-only WebM fixture through the installed metadata parser without a duration header", async () => {
    const text = (value: string) => [...new TextEncoder().encode(value)];
    const sampling = new Uint8Array(8); new DataView(sampling.buffer).setFloat64(0, 48_000);
    const opusHead = [...text("OpusHead"), 1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0];
    const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], text("webm")));
    const entry = element([0xae], [
      ...element([0xd7], [1]), ...element([0x73, 0xc5], [1]), ...element([0x83], [2]),
      ...element([0x86], text("A_OPUS")), ...element([0x63, 0xa2], opusHead),
      ...element([0xe1], [...element([0xb5], [...sampling]), ...element([0x9f], [1])]),
    ]);
    const tracks = element([0x16, 0x54, 0xae, 0x6b], entry);
    const cluster = element([0x1f, 0x43, 0xb6, 0x75], [...element([0xe7], [0]), ...element([0xa3], [0x81, 0, 0, 0x80, 0xf8, 0xff, 0xfe]), ...element([0xa3], [0x81, 3, 0xe8, 0x80, 0xf8, 0xff, 0xfe])]);
    const bytes = new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, 0xff, ...tracks, ...cluster]);
    expect(await validateTicketVoiceFile(new File([bytes], "sample.webm", { type: "audio/webm" }), bytes)).toMatchObject({ ok: true, mimeType: "audio/webm", durationMs: 1020 });
  });

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBuffer } from "music-metadata";
import { validateTicketVoiceFile } from "../lib/tickets/ticket-voice-file";
import { webmOpusDurationMs } from "../lib/tickets/webm-opus-duration";
import { validateTicketAttachment } from "../lib/tickets/ticket-attachment-file";

vi.mock("music-metadata", () => ({ parseBuffer: vi.fn() }));

function element(id: number[], payload: number[]) {
  return [...id, 0x80 | payload.length, ...payload];
}
function webm(relative = 1000, lacing = 0) {
  const first = element([0xa3], [0x81, 0, 0, lacing, 0xf8, 0xff]);
  const last = element([0xa3], [0x81, (relative >> 8) & 255, relative & 255, lacing, 0xf8, 0xff]);
  return new Uint8Array(element([0x18, 0x53, 0x80, 0x67], element([0x1f, 0x43, 0xb6, 0x75], [...element([0xe7], [0]), ...first, ...last])));
}

describe("bounded WebM Opus timing", () => {
  it("measures packet timestamps without a client timer or Segment duration", () => {
    expect(webmOpusDurationMs(webm())).toBe(1020);
  });
  it("accepts an unknown-length MediaRecorder Segment", () => {
    const bytes = webm(); bytes[4] = 0xff;
    expect(webmOpusDurationMs(bytes)).toBe(1020);
  });
  it("walks repeated unknown-length clusters as siblings, without growing recursion", () => {
    const clusters = Array.from({ length: 12 }, (_, index) => [0x1f, 0x43, 0xb6, 0x75, 0xff, ...element([0xe7], [index * 10]), ...element([0xa3], [0x81, 0, 0, 0, 0xf8, 0xff])]).flat();
    const bytes = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0xff, ...clusters]);
    expect(webmOpusDurationMs(bytes)).toBe(240);
  });
  it.each([new Uint8Array(), new Uint8Array([0]), new Uint8Array([0xa3, 0xff]), new Uint8Array([0xa3, 0x85, 0x81]), webm(1, 6)])("rejects malformed/truncated/laced bytes without unbounded traversal", (bytes) => {
    expect(() => webmOpusDurationMs(bytes)).toThrow();
  });
  it("rejects unsafe sizes and deep nested Segment structures", () => {
    expect(() => webmOpusDurationMs(new Uint8Array([0x18, 0x53, 0x80, 0x67, 1, 0xfe, 255, 255, 255, 255, 255, 255]))).toThrow();
    let nested = [0xe7, 0x81, 0];
    for (let i = 0; i < 6; i++) nested = element([0x18, 0x53, 0x80, 0x67], nested);
    expect(() => webmOpusDurationMs(new Uint8Array(nested))).toThrow("nesting");
  });
  it("caps traversal even for a small-byte element flood", () => {
    const bytes = new Uint8Array(200_002);
    for (let i = 0; i < bytes.length; i += 2) { bytes[i] = 0xec; bytes[i + 1] = 0x80; }
    expect(() => webmOpusDurationMs(bytes)).toThrow("Too many");
  });
});

describe("Ticket voice validation", () => {
  beforeEach(() => vi.mocked(parseBuffer).mockReset());
  it("accepts browser WebM audio after inspecting codec and timing from bytes", async () => {
    vi.mocked(parseBuffer).mockResolvedValue({ format: { container: "EBML/webm", codec: "OPUS", trackInfo: [{ type: 2 }] } } as never);
    const bytes = webm();
    await expect(validateTicketVoiceFile(new File([bytes], "voice.webm", { type: "audio/webm" }), bytes)).resolves.toMatchObject({ ok: true, mimeType: "audio/webm", durationMs: 1020 });
  });
  it("rejects a video track masquerading as audio", async () => {
    vi.mocked(parseBuffer).mockResolvedValue({ format: { container: "EBML/webm", codec: "OPUS", trackInfo: [{ type: 1 }] } } as never);
    const bytes = webm();
    await expect(validateTicketVoiceFile(new File([bytes], "voice.webm", { type: "audio/webm" }), bytes)).resolves.toMatchObject({ ok: false });
  });
  it("defers MP4 audio because a header duration alone cannot enforce the recording duration limit", async () => {
    vi.mocked(parseBuffer).mockResolvedValue({ format: { container: "MP4", codec: "AAC", duration: 1 } } as never);
    const bytes = new Uint8Array([1]);
    expect(await validateTicketVoiceFile(new File([bytes], "voice.m4a", { type: "audio/mp4" }), bytes)).toMatchObject({ ok: false });
    expect(parseBuffer).not.toHaveBeenCalled();
  });
  it("rejects mismatched MIME, missing duration and over-five-minute duration", async () => {
    const bytes = new Uint8Array([1]);
    for (const format of [{ container: "Ogg", codec: "Opus", duration: 3 }, { container: "MP4", codec: "AAC" }, { container: "MP4", codec: "AAC", duration: 301 }]) {
      vi.mocked(parseBuffer).mockResolvedValue({ format } as never);
      await expect(validateTicketVoiceFile(new File([bytes], "voice.m4a", { type: "audio/mp4" }), bytes)).resolves.toMatchObject({ ok: false });
    }
  });
  it("rejects empty, oversized and unsupported input before metadata inspection", async () => {
    const empty = new File([], "voice.webm", { type: "audio/webm" });
    expect(await validateTicketVoiceFile(empty, new Uint8Array())).toMatchObject({ ok: false });
    const large = new Uint8Array(5 * 1024 * 1024 + 1);
    expect(await validateTicketVoiceFile(new File([large], "voice.webm", { type: "audio/webm" }), large)).toMatchObject({ ok: false });
    expect(await validateTicketVoiceFile(new File(["x"], "voice.wav", { type: "audio/wav" }), new Uint8Array([120]))).toMatchObject({ ok: false });
    expect(parseBuffer).not.toHaveBeenCalled();
  });
  it("leaves the ordinary attachment validator unchanged", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    expect(validateTicketAttachment(new File([bytes], "test.pdf"), bytes)).toMatchObject({ ok: true, mimeType: "application/pdf" });
    expect(validateTicketAttachment(new File(["OggS"], "voice.ogg", { type: "audio/ogg" }), new TextEncoder().encode("OggS"))).toMatchObject({ ok: false });
  });
});

it("extends only the existing RPC MIME clause, preserving all authorization and ACL statements", () => {
  const source = readFileSync("supabase/migrations/20260926203443_client_conversation_notifications_and_project_purchase.sql", "utf8").replace(/\r\n/g, "\n");
  const migration = readFileSync("supabase/migrations/20261026044125_ticket_voice_messages.sql", "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("create or replace function public.app_send_ticket_message_with_attachment(");
  const end = source.indexOf("create or replace function public.app_get_ticket_attachment_download(", start);
  const actual = migration.slice(migration.indexOf("create or replace function"), migration.indexOf("-- Storage metadata")).replace(",\n       'audio/webm', 'audio/ogg')", ")").trim();
  expect(actual).toBe(source.slice(start, end).trim());
  expect(migration).not.toMatch(/\b(grant|revoke|policy|alter table)\b/i);
});

it("adds the raw-audio metadata guard only to the reviewed post-audio function body", () => {
  const audioMigration = readFileSync("supabase/migrations/20261026044125_ticket_voice_messages.sql", "utf8").replace(/\r\n/g, "\n");
  const guardMigration = audioMigration.slice(audioMigration.indexOf("do $migration$"));
  const definition = audioMigration.slice(audioMigration.indexOf("create or replace function"));
  const body = /as \$\$([\s\S]*?)\$\$;/.exec(definition)?.[1];
  expect(body).toBeDefined();
  expect(guardMigration).toContain(createHash("md5").update(body!).digest("hex"));
  expect(body?.split("  select * into actor from private.current_ticket_actor();\n")).toHaveLength(2);
  expect(guardMigration).toContain("p_mime_type in ('audio/webm', 'audio/ogg')");
  expect(guardMigration).toContain("p_order_id is not null or p_ticket_id is null");
  expect(guardMigration).toContain("metadata ->> 'mimetype' = p_mime_type");
  expect(guardMigration).toContain("metadata ->> 'size' = p_size_bytes::text");
  expect(guardMigration).not.toMatch(/\b(grant|revoke|policy|alter table)\b/i);
});

import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  buildAvatarObjectPath,
  validateAvatarBytes,
} from "../lib/images/avatar-file";

const PROFILE_ID = "2f000000-0000-4000-8000-000000000001";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** RIFF <4-byte size> WEBP */
function webpHeader(): Uint8Array {
  return bytes(0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("avatar format is decided by file signature, not by the upload", () => {
  it("accepts a real JPEG, PNG and WebP", () => {
    expect(validateAvatarBytes(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toEqual({
      ok: true,
      format: { mimeType: "image/jpeg", extension: "jpg" },
    });

    expect(
      validateAvatarBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)),
    ).toEqual({ ok: true, format: { mimeType: "image/png", extension: "png" } });

    expect(validateAvatarBytes(webpHeader())).toEqual({
      ok: true,
      format: { mimeType: "image/webp", extension: "webp" },
    });
  });

  /*
   * The dangerous cases. An SVG can carry script, and an HTML document served
   * from a storage origin is a stored-XSS primitive — neither may ever be
   * accepted regardless of what the browser claimed the type was.
   */
  it("rejects SVG, HTML and other non-image payloads", () => {
    for (const payload of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<?xml version="1.0"?><svg onload="alert(1)"/>',
      "<!doctype html><html><body><script>alert(1)</script></body></html>",
      "GIF89a",
      "%PDF-1.7",
      "#!/bin/sh\necho hi",
    ]) {
      const result = validateAvatarBytes(utf8(payload));
      expect(result.ok, `expected rejection for: ${payload.slice(0, 24)}`).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Image must be JPEG, PNG, or WebP.");
      }
    }
  });

  it("rejects a payload whose extension and MIME lie about its content", () => {
    /* A .jpg name and image/jpeg MIME cannot rescue SVG bytes. */
    const result = validateAvatarBytes(utf8("<svg/>"));
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = validateAvatarBytes(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });
});

describe("avatar size ceiling", () => {
  it("rejects bytes over 5 MB even when the declared size is small", () => {
    const oversized = new Uint8Array(AVATAR_MAX_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff]);

    const result = validateAvatarBytes(oversized, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Image must be smaller than 5 MB.");
  });

  it("rejects an oversized declared size even when the buffer is small", () => {
    const result = validateAvatarBytes(
      bytes(0xff, 0xd8, 0xff),
      AVATAR_MAX_BYTES + 1,
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a file exactly at the ceiling", () => {
    const atLimit = new Uint8Array(AVATAR_MAX_BYTES);
    atLimit.set([0xff, 0xd8, 0xff]);
    expect(validateAvatarBytes(atLimit, AVATAR_MAX_BYTES).ok).toBe(true);
  });
});

describe("object paths are server-generated and owner-scoped", () => {
  it("always nests the object under the profile id folder", () => {
    const path = buildAvatarObjectPath(
      PROFILE_ID,
      { mimeType: "image/webp", extension: "webp" },
      "abc-123",
    );

    expect(path).toBe(`${PROFILE_ID}/abc-123.webp`);
    /* The first segment is what the storage policies compare to auth.uid(). */
    expect(path.split("/")[0]).toBe(PROFILE_ID);
  });

  it("never derives the stored name from a user-supplied filename", () => {
    const path = buildAvatarObjectPath(
      PROFILE_ID,
      { mimeType: "image/png", extension: "png" },
      "generated",
    );

    expect(path).not.toMatch(/\.\./);
    expect(path.endsWith(".png")).toBe(true);
    expect(path).toBe(`${PROFILE_ID}/generated.png`);
  });
});

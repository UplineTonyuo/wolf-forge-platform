/**
 * Avatar upload validation.
 *
 * The browser's reported MIME type, the filename and the extension are all
 * attacker-controlled, so none of them decide anything here. The format is
 * determined by reading the actual file signature, which is what stops a
 * polyglot, an HTML document or an SVG from being stored as an "image".
 *
 * There is deliberately no re-encode step: the only credible way to normalize
 * image bytes in this stack is a native dependency such as `sharp`, which is a
 * large addition to carry for avatars alone. Signature validation plus a
 * server-controlled object path, a locked-down bucket MIME allowlist and a
 * strict size ceiling is the trade taken here. If untrusted (client-supplied)
 * imagery is ever accepted elsewhere, revisit that decision.
 */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export type AvatarFormat = {
  /** Canonical MIME type, derived from the signature and never from the upload. */
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export type AvatarValidationResult =
  | { ok: true; format: AvatarFormat }
  | { ok: false; error: string };

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/** RIFF....WEBP — the size field between the two markers is skipped. */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return (
    startsWith(bytes, riff) &&
    webp.every((value, index) => bytes[8 + index] === value)
  );
}

/**
 * Resolves the real format of an upload, or an error safe to show a user.
 *
 * `declaredSize` lets the caller reject an oversized upload before the bytes
 * are buffered; the byte length is checked again here so the ceiling holds even
 * if the declared size lied.
 */
export function validateAvatarBytes(
  bytes: Uint8Array,
  declaredSize?: number,
): AvatarValidationResult {
  if (bytes.length === 0) {
    return { ok: false, error: "That file is empty. Choose an image to upload." };
  }

  if (bytes.length > AVATAR_MAX_BYTES || (declaredSize ?? 0) > AVATAR_MAX_BYTES) {
    return { ok: false, error: "Image must be smaller than 5 MB." };
  }

  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return { ok: true, format: { mimeType: "image/jpeg", extension: "jpg" } };
  }

  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { ok: true, format: { mimeType: "image/png", extension: "png" } };
  }

  if (isWebp(bytes)) {
    return { ok: true, format: { mimeType: "image/webp", extension: "webp" } };
  }

  /*
   * Everything else — SVG, HTML, GIF, PDF, archives, scripts — lands here. The
   * message stays generic rather than reporting what was detected, so the
   * endpoint is not a format-probing oracle.
   */
  return { ok: false, error: "Image must be JPEG, PNG, or WebP." };
}

/**
 * Builds the storage object path for an avatar.
 *
 * The path is fully server-generated: the profile id folder is what the storage
 * policies check, and the filename is random so an upload can never overwrite
 * an unrelated object or smuggle traversal segments.
 */
export function buildAvatarObjectPath(
  profileId: string,
  format: AvatarFormat,
  randomId: string,
): string {
  return `${profileId}/${randomId}.${format.extension}`;
}

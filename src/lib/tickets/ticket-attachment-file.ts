export const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TICKET_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
].join(",");

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

function detectedMimeType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 8) === "\u0089PNG\r\n\u001a\n") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (ascii(bytes, 4, 4) === "ftyp") return ascii(bytes, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  return null;
}

export function validateTicketAttachment(file: File, bytes: Uint8Array) {
  if (!file.size || file.size !== bytes.byteLength) return { ok: false as const, error: "Choose a non-empty file." };
  if (file.size > TICKET_ATTACHMENT_MAX_BYTES) return { ok: false as const, error: "File must be 5 MB or smaller." };

  const mimeType = detectedMimeType(bytes);
  if (!mimeType) return { ok: false as const, error: "That file type is not supported." };

  const originalName = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  if (!originalName) return { ok: false as const, error: "The file needs a valid name." };

  return { ok: true as const, mimeType, originalName, sizeBytes: file.size };
}

import "server-only";

import { parseBuffer } from "music-metadata";
import { TICKET_ATTACHMENT_MAX_BYTES, TICKET_AUDIO_MAX_DURATION_MS, TICKET_AUDIO_MIME_TYPES } from "./ticket-attachment-file";
import { webmOpusDurationMs } from "./webm-opus-duration";
import { oggOpusDurationMs } from "./ogg-opus-duration";

export async function validateTicketVoiceFile(file: File, bytes: Uint8Array) {
  if (!file.size || file.size !== bytes.byteLength) return { ok: false as const, error: "Choose a non-empty recording." };
  if (file.size > TICKET_ATTACHMENT_MAX_BYTES) return { ok: false as const, error: "Recording must be 5 MB or smaller." };
  const declared = (file.type.split(";")[0] ?? "").toLowerCase();
  if (!TICKET_AUDIO_MIME_TYPES.some((type) => type === declared)) return { ok: false as const, error: "That recording format is not supported." };
  const originalName = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  if (!originalName) return { ok: false as const, error: "The recording needs a valid name." };

  try {
    const metadata = await parseBuffer(bytes, { mimeType: declared }, { duration: true, skipCovers: true });
    const container = metadata.format.container?.toLowerCase() ?? "";
    const codec = metadata.format.codec?.toLowerCase() ?? "";
    const mimeType = (container.includes("webm") || container.includes("ebml")) && codec.includes("opus") ? "audio/webm"
      : container.includes("ogg") && codec.includes("opus") ? "audio/ogg" : null;
    if (!mimeType || mimeType !== declared || metadata.format.hasVideo || metadata.format.trackInfo?.some((track) => track.type === 1 || track.video)) {
      return { ok: false as const, error: "Use an audio-only recording in a supported format." };
    }
    // Chrome omits WebM duration. Read its Opus block timestamps, never a browser-supplied timer.
    const durationMs = mimeType === "audio/webm" ? webmOpusDurationMs(bytes)
      : mimeType === "audio/ogg" ? oggOpusDurationMs(bytes) : (metadata.format.duration ?? 0) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > TICKET_AUDIO_MAX_DURATION_MS) {
      return { ok: false as const, error: "Recording must have a verifiable duration of 5 minutes or less." };
    }
    return { ok: true as const, mimeType, originalName, sizeBytes: file.size, durationMs };
  } catch {
    return { ok: false as const, error: "The recording could not be verified. Please record it again." };
  }
}

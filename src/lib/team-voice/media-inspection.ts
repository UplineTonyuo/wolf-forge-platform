import "server-only";

import { parseBuffer } from "music-metadata";
import {
  teamVoiceMaxBytes,
  teamVoiceMaxDurationMs,
  type TeamVoiceMimeType,
} from "../../domain/team/schema";
import { ValidationError } from "../errors/application-error";

export type InspectedTeamVoice = {
  durationMs: number;
  sizeBytes: number;
  mimeType: "audio/webm" | "audio/ogg" | "audio/mp4";
};

function canonicalMime(container: string | undefined, codec: string | undefined): InspectedTeamVoice["mimeType"] | null {
  const normalizedContainer = container?.toLocaleLowerCase() ?? "";
  const normalizedCodec = codec?.toLocaleLowerCase() ?? "";

  if ((normalizedContainer.includes("webm") || normalizedContainer.includes("ebml")) && normalizedCodec.includes("opus")) {
    return "audio/webm";
  }
  if (normalizedContainer.includes("ogg") && normalizedCodec.includes("opus")) {
    return "audio/ogg";
  }
  if (
    (normalizedContainer.includes("mp4") || normalizedContainer.includes("m4a") || normalizedContainer.includes("isom")) &&
    (normalizedCodec.includes("aac") || normalizedCodec.includes("mp4a"))
  ) {
    return "audio/mp4";
  }
  return null;
}

export async function inspectTeamVoiceBytes(input: {
  bytes: Uint8Array;
  objectSize: number;
  objectMimeType: string | null;
  declaredMimeType: TeamVoiceMimeType;
  recordedDurationMs: number;
}): Promise<InspectedTeamVoice> {
  if (input.objectSize < 1 || input.objectSize > teamVoiceMaxBytes || input.bytes.byteLength !== input.objectSize) {
    throw new ValidationError("Voice recording must be smaller than 5 MB.");
  }

  let metadata;
  try {
    metadata = await parseBuffer(input.bytes, { mimeType: input.objectMimeType ?? undefined }, { duration: true });
  } catch (error) {
    throw new ValidationError("Voice recording format is not supported.", error);
  }

  const mimeType = canonicalMime(metadata.format.container, metadata.format.codec);
  const measuredSeconds = metadata.format.duration;
  if (!mimeType || !Number.isFinite(measuredSeconds) || !measuredSeconds || measuredSeconds <= 0) {
    throw new ValidationError("Voice recording format is not supported.");
  }

  const durationMs = Math.round(measuredSeconds * 1000);
  if (durationMs > teamVoiceMaxDurationMs) {
    throw new ValidationError("Voice recording must be 5 minutes or shorter.");
  }

  const declaredFamily = input.declaredMimeType.split(";")[0];
  const objectFamily = input.objectMimeType?.split(";")[0]?.toLocaleLowerCase() ?? "";
  if (declaredFamily !== mimeType || (objectFamily && objectFamily !== mimeType)) {
    throw new ValidationError("Voice recording format does not match the upload slot.");
  }

  // MediaRecorder timers are not authoritative, but a large disagreement is a useful corruption check.
  if (Math.abs(durationMs - input.recordedDurationMs) > 5_000) {
    throw new ValidationError("Voice recording duration could not be verified.");
  }

  return { durationMs, sizeBytes: input.objectSize, mimeType };
}

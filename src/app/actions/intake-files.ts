"use server";

import { z } from "zod";
import { readServerEnvironment } from "../../lib/env/server-env";
import { toClientSafeError } from "../../lib/errors/application-error";
import { mapDatabaseError } from "../../lib/errors/map-database-error";
import { INTAKE_FILE_ACCEPT, INTAKE_FILE_BUCKET, INTAKE_FILE_MAX_BYTES, intakeFileSchema } from "../../lib/forms/intake-file";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { getClientContext, getSelfServiceContext } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";
import { validateTicketAttachment } from "../../lib/tickets/ticket-attachment-file";
import { TicketAttachmentStorageRepository } from "../../repositories/ticket-attachment-storage-repository";

export async function uploadIntakeFile(input: { id: string; assignmentId: string; fieldKey: string }, formData: FormData) {
  try {
    z.object({ id: z.uuid(), assignmentId: z.uuid(), fieldKey: z.uuid() }).strict().parse(input);
    const context = await getClientContext();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size > INTAKE_FILE_MAX_BYTES) return { ok: false as const, error: "Choose an image or PDF up to 4 MB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = validateTicketAttachment(file, bytes);
    if (!valid.ok) return valid;
    if (!INTAKE_FILE_ACCEPT.split(",").includes(valid.mimeType)) return { ok: false as const, error: "Choose an image or PDF." };
    await enforceServerCostLimit({ actorId: context.actor.id, action: "intake.file_upload" });
    const storage = new TicketAttachmentStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment()), INTAKE_FILE_BUCKET);
    const checksum = storage.checksum(bytes);
    const claim = await context.client.rpc("app_prepare_intake_file", {
      p_id: input.id, p_assignment_id: input.assignmentId, p_field_key: input.fieldKey,
      p_name: valid.originalName, p_mime: valid.mimeType, p_size: valid.sizeBytes, p_checksum: checksum,
    });
    if (claim.error) throw mapDatabaseError(claim.error, "Form upload");
    const path = z.string().min(1).parse(claim.data);
    await storage.storeOrConfirm(path, bytes, valid.mimeType, checksum);
    await storage.storeOrConfirm(path, bytes, valid.mimeType, checksum);
    const finished = await context.client.rpc("app_finish_intake_file", { p_id: input.id });
    if (finished.error) throw mapDatabaseError(finished.error, "Form upload");
    return { ok: true as const, file: { id: input.id, name: valid.originalName, size: valid.sizeBytes } };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}

export async function loadIntakeFileInfo(id: string) {
  try {
    z.uuid().parse(id);
    const context = await getSelfServiceContext();
    const result = await context.client.rpc("app_get_intake_file", { p_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Form file");
    const file = intakeFileSchema.parse(result.data);
    return { ok: true as const, file: { id: file.id, name: file.name, size: file.size } };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}

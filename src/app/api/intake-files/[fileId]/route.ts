import { z } from "zod";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { mapDatabaseError } from "../../../../lib/errors/map-database-error";
import { INTAKE_FILE_BUCKET, intakeFileSchema } from "../../../../lib/forms/intake-file";
import { enforcePrivateDownloadByteBudget, enforceServerCostLimit, PRIVATE_DOWNLOAD_BUDGET_WINDOW_SECONDS } from "../../../../lib/security/server-cost-limit";
import { getSelfServiceContext } from "../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";
import { TicketAttachmentStorageRepository } from "../../../../repositories/ticket-attachment-storage-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const context = await getSelfServiceContext();
  let retryAfter = 60;
  try {
    const { fileId } = await params;
    z.uuid().parse(fileId);
    const result = await context.client.rpc("app_get_intake_file", { p_id: fileId });
    if (result.error) throw mapDatabaseError(result.error, "Form file");
    const file = intakeFileSchema.extend({ tenant_id: z.uuid() }).parse(result.data);
    await enforceServerCostLimit({ actorId: context.actor.id, action: "intake.file_download" });
    retryAfter = PRIVATE_DOWNLOAD_BUDGET_WINDOW_SECONDS;
    await enforcePrivateDownloadByteBudget({ actorId: context.actor.id, tenantId: file.tenant_id, sizeBytes: file.size });
    const storage = new TicketAttachmentStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment()), INTAKE_FILE_BUCKET);
    const object = await storage.download(file.path);
    const name = file.name.replace(/["\r\n\\]/g, "");
    return new Response(object, { headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Length": String(object.size),
    } });
  } catch (error) {
    const safe = toClientSafeError(error);
    return new Response(safe.message, {
      status: safe.code === "RATE_LIMITED" ? 429 : safe.code === "PERMISSION_DENIED" ? 403 : 404,
      headers: { "Cache-Control": "private, no-store", ...(safe.code === "RATE_LIMITED" ? { "Retry-After": String(retryAfter) } : {}) },
    });
  }
}

import { z } from "zod";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { enforcePrivateDownloadByteBudget, enforceServerCostLimit, PRIVATE_DOWNLOAD_BUDGET_WINDOW_SECONDS } from "../../../../lib/security/server-cost-limit";
import { getSelfServiceContext } from "../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";
import { TicketRepository } from "../../../../repositories/ticket-repository";
import { TicketAttachmentStorageRepository } from "../../../../repositories/ticket-attachment-storage-repository";
import { TicketService } from "../../../../services/ticket-service";

function inlineContentDisposition(originalName: string): string {
  // The stored name is already sanitized at upload time (control characters
  // stripped, length-capped), but the header value is built here from a
  // server-trusted field either way — escape the one character that would
  // break the quoted-string form, and add a same-shape ASCII fallback per
  // RFC 6266 so non-ASCII names still degrade safely instead of corrupting
  // the header.
  const safe = originalName.replace(/["\r\n]/g, "");
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const context = await getSelfServiceContext();
  let retryAfter = 60;

  try {
    const environment = readServerEnvironment();
    const tickets = new TicketService({ repository: new TicketRepository(context.client) });
    // Authorization happens entirely inside this call (attachment scan
    // status, Ticket access, Order access, internal-note-vs-client
    // visibility) — see app_get_ticket_attachment_download. Nothing below
    // this line re-derives or bypasses that check.
    const attachment = await tickets.attachmentDownload(attachmentId, context.actor);
    const metadata = z.object({ tenant_id: z.uuid(), size_bytes: z.number().int().positive() }).parse(attachment);
    await enforceServerCostLimit({ actorId: context.actor.id, action: "ticket.file_download" });
    retryAfter = PRIVATE_DOWNLOAD_BUDGET_WINDOW_SECONDS;
    await enforcePrivateDownloadByteBudget({ actorId: context.actor.id, tenantId: metadata.tenant_id, sizeBytes: metadata.size_bytes });
    const storage = new TicketAttachmentStorageRepository(
      createTrustedServerSupabaseClient(environment),
    );
    // The object's bytes are fetched with the trusted service-role client
    // and streamed to the browser directly. The browser must never see a
    // Supabase Storage host, bucket, or signed token — only this route.
    const object = await storage.download(attachment.storage_object_key);
    return new Response(object, {
      status: 200,
      headers: {
        "Content-Type": attachment.mime_type,
        "Content-Disposition": inlineContentDisposition(attachment.original_name),
        "Content-Length": String(object.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const safe = toClientSafeError(error);
    return new Response(safe.message, {
      status: safe.code === "RATE_LIMITED" ? 429 : safe.code === "NOT_FOUND" ? 404 : safe.code === "PERMISSION_DENIED" ? 403 : 400,
      headers: { "Cache-Control": "private, no-store", ...(safe.code === "RATE_LIMITED" ? { "Retry-After": String(retryAfter) } : {}) },
    });
  }
}

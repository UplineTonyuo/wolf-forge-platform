import { toClientSafeError } from "../../../../lib/errors/application-error";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { getSelfServiceContext } from "../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";
import { TicketRepository } from "../../../../repositories/ticket-repository";
import { TicketAttachmentStorageRepository } from "../../../../repositories/ticket-attachment-storage-repository";
import { TicketService } from "../../../../services/ticket-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const context = await getSelfServiceContext();

  try {
    const tickets = new TicketService({ repository: new TicketRepository(context.client) });
    const attachment = await tickets.attachmentDownload(attachmentId, context.actor);
    const storage = new TicketAttachmentStorageRepository(
      createTrustedServerSupabaseClient(readServerEnvironment()),
    );
    return Response.redirect(await storage.signedUrl(attachment.storage_object_key), 302);
  } catch (error) {
    const safe = toClientSafeError(error);
    return new Response(safe.message, {
      status: safe.code === "NOT_FOUND" ? 404 : safe.code === "PERMISSION_DENIED" ? 403 : 400,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { TICKET_ATTACHMENT_MAX_BYTES, validateTicketAttachment } from "../../lib/tickets/ticket-attachment-file";
import { readServerEnvironment } from "../../lib/env/server-env";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";
import { TicketAttachmentStorageRepository } from "../../repositories/ticket-attachment-storage-repository";

export type TicketMutationResult = { ok: true } | { ok: false; error: string };

const failure = (error: unknown): TicketMutationResult => ({ ok: false, error: toClientSafeError(error).message });

function refreshTicket(ticketId: string) {
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/account/messages");
  revalidatePath(`/account/messages/${ticketId}`);
  // The rail's "waiting on you" count and the Dashboard both read ticket state,
  // so a reply has to refresh the portal shell as well as the conversation.
  revalidatePath("/account");
}

function refreshOrder(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/account/projects");
  revalidatePath(`/account/projects/${orderId}`);
  revalidatePath("/account");
}

export async function createClientTicketAction(input: { requestId: string; subject: string; message: string }): Promise<TicketMutationResult> {
  const context = await getClientContext();
  let ticketId: string;
  try {
    const ticket = await context.services.tickets.create({ request_id: input.requestId, subject: input.subject, message: input.message }, context.actor);
    ticketId = ticket.id;
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/account/messages");
  revalidatePath("/account");
  redirect(`/account/messages/${ticketId}?created=1`);
}

export type CreateInternalTicketResult =
  | { ok: true; ticketId: string }
  | { ok: false; error: string };

export async function createInternalTicketAction(input: {
  requestId: string;
  companyId: string;
  subject: string;
  message: string;
  priority: string;
}): Promise<CreateInternalTicketResult> {
  const context = await getInternalContext();

  if (!context.user.tickets.create) {
    return {
      ok: false,
      error: "You do not have permission to create Tickets.",
    };
  }

  try {
    const ticket = await context.services.tickets.create(
      {
        request_id: input.requestId,
        company_id: input.companyId,
        subject: input.subject,
        message: input.message,
        priority: input.priority,
      },
      context.actor,
    );

    refreshTicket(ticket.id);

    return {
      ok: true,
      ticketId: ticket.id,
    };
  } catch (error) {
    return {
      ok: false,
      error: toClientSafeError(error).message,
    };
  }
}

export async function adminReplyTicketAction(ticketId: string, requestId: string, body: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.reply) return { ok: false, error: "You do not have permission to reply to Tickets." };
  try { await context.services.tickets.reply(ticketId, { request_id: requestId, body }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function clientReplyTicketAction(ticketId: string, requestId: string, body: string): Promise<TicketMutationResult> {
  const context = await getClientContext();
  try { await context.services.tickets.reply(ticketId, { request_id: requestId, body }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function addTicketInternalNoteAction(ticketId: string, requestId: string, body: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.internalNotes) return { ok: false, error: "You do not have permission to add internal notes." };
  try { await context.services.tickets.addInternalNote(ticketId, { request_id: requestId, body }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function adminSendOrderMessageAction(orderId: string, requestId: string, body: string, internalNote: boolean): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (internalNote ? !context.user.tickets.internalNotes : !context.user.tickets.reply) {
    return { ok: false, error: internalNote ? "You do not have permission to add internal notes." : "You do not have permission to reply to Tickets." };
  }
  try { await context.services.tickets.sendForOrder(orderId, { request_id: requestId, body }, internalNote, context.actor); }
  catch (error) { return failure(error); }
  refreshOrder(orderId);
  return { ok: true };
}

export async function clientSendOrderMessageAction(orderId: string, requestId: string, body: string): Promise<TicketMutationResult> {
  const context = await getClientContext();
  try { await context.services.tickets.sendForOrder(orderId, { request_id: requestId, body }, false, context.actor); }
  catch (error) { return failure(error); }
  refreshOrder(orderId);
  return { ok: true };
}

export type TicketComposerActionInput = {
  requestId: string;
  mode: "admin" | "client" | "note";
  target: { kind: "ticket"; ticketId: string } | { kind: "order"; orderId: string };
  replyTo?: { ticketId: string; messageId: string } | null;
};

export async function sendTicketComposerAction(
  input: TicketComposerActionInput,
  formData: FormData,
): Promise<TicketMutationResult> {
  const body = String(formData.get("body") ?? "").trim();
  const candidate = formData.get("attachment");
  const file = candidate instanceof File && candidate.size > 0 ? candidate : null;

  if (!body && !file) return { ok: false, error: "Write a reply or add a file." };
  if (file && input.mode === "note") return { ok: false, error: "Attachments are not available for internal notes." };
  if (file && file.size > TICKET_ATTACHMENT_MAX_BYTES) return { ok: false, error: "File must be 5 MB or smaller." };

  const internalContext = input.mode === "client" ? null : await getInternalContext();
  if (internalContext) {
    const allowed = input.mode === "note" ? internalContext.user.tickets.internalNotes : internalContext.user.tickets.reply;
    if (!allowed) return { ok: false, error: "You do not have permission to send this message." };
  }
  const context = internalContext ?? await getClientContext();

  const target = input.replyTo
    ? { ticket_id: input.replyTo.ticketId, order_id: null }
    : input.target.kind === "ticket"
      ? { ticket_id: input.target.ticketId, order_id: null }
      : { ticket_id: null, order_id: input.target.orderId };

  try {
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validated = validateTicketAttachment(file, bytes);
      if (!validated.ok) return { ok: false, error: validated.error };

      const attachmentTarget = {
        request_id: input.requestId,
        ...target,
        reply_to_message_id: input.replyTo?.messageId ?? null,
      };
      const claim = await context.services.tickets.prepareAttachment(attachmentTarget, context.actor);
      const storage = new TicketAttachmentStorageRepository(
        createTrustedServerSupabaseClient(readServerEnvironment()),
      );
      const checksum = storage.checksum(bytes);
      const stored = await storage.storeOrConfirm(claim.storage_key, bytes, validated.mimeType, checksum);

      try {
        await context.services.tickets.sendWithAttachment({
          ...attachmentTarget,
          body,
          attachment: {
            original_name: validated.originalName,
            mime_type: validated.mimeType,
            size_bytes: validated.sizeBytes,
            checksum_sha256: checksum,
          },
        }, context.actor);
      } catch (error) {
        if (stored) await storage.remove(claim.storage_key).catch(() => undefined);
        throw error;
      }
    } else if (input.replyTo) {
      await context.services.tickets.replyToMessage(input.replyTo.ticketId, {
        request_id: input.requestId,
        body,
        reply_to_message_id: input.replyTo.messageId,
      }, context.actor);
    } else if (input.target.kind === "order") {
      await context.services.tickets.sendForOrder(
        input.target.orderId,
        { request_id: input.requestId, body },
        input.mode === "note",
        context.actor,
      );
    } else if (input.mode === "note") {
      await context.services.tickets.addInternalNote(
        input.target.ticketId,
        { request_id: input.requestId, body },
        context.actor,
      );
    } else {
      await context.services.tickets.reply(
        input.target.ticketId,
        { request_id: input.requestId, body },
        context.actor,
      );
    }
  } catch (error) {
    return failure(error);
  }

  if (input.target.kind === "order") refreshOrder(input.target.orderId);
  else refreshTicket(input.target.ticketId);
  return { ok: true };
}

export async function adminReplyToTicketMessageAction(
  ticketId: string,
  requestId: string,
  body: string,
  replyToMessageId: string,
): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.reply) {
    return { ok: false, error: "You do not have permission to reply to Tickets." };
  }
  try {
    await context.services.tickets.replyToMessage(ticketId, {
      request_id: requestId,
      body,
      reply_to_message_id: replyToMessageId,
    }, context.actor);
  } catch (error) {
    return failure(error);
  }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function unsendTicketInternalNoteAction(messageId: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.internalNotes) {
    return { ok: false, error: "You do not have permission to unsend internal notes." };
  }
  try {
    const source = await context.services.tickets.unsendInternalNote(messageId, context.actor);
    refreshTicket(source.ticket_id);
    if (source.order_id) refreshOrder(source.order_id);
  } catch (error) {
    return failure(error);
  }
  return { ok: true };
}

export async function clientReplyToTicketMessageAction(
  ticketId: string,
  requestId: string,
  body: string,
  replyToMessageId: string,
): Promise<TicketMutationResult> {
  const context = await getClientContext();
  try {
    await context.services.tickets.replyToMessage(ticketId, {
      request_id: requestId,
      body,
      reply_to_message_id: replyToMessageId,
    }, context.actor);
  } catch (error) {
    return failure(error);
  }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function toggleTicketMessageReactionAction(
  messageId: string,
  reactionCode: string,
): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.reply) {
    return { ok: false, error: "You do not have permission to react to Ticket messages." };
  }
  try {
    await context.services.tickets.toggleReaction({
      message_id: messageId,
      reaction_code: reactionCode,
    }, context.actor);
  } catch (error) {
    return failure(error);
  }
  return { ok: true };
}

export async function forwardTicketMessageToTeamAction(input: {
  requestId: string;
  sourceMessageId: string;
  destinationConversationId: string;
  comment?: string | null;
}): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.view || !context.user.teamMessaging.use) {
    return { ok: false, error: "You do not have permission to forward this message." };
  }
  try {
    await context.services.tickets.forwardToTeam({
      request_id: input.requestId,
      source_message_id: input.sourceMessageId,
      destination_conversation_id: input.destinationConversationId,
      comment: input.comment,
    }, context.actor);
  } catch (error) {
    return failure(error);
  }
  return { ok: true };
}

export async function updateTicketStatusAction(ticketId: string, status: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.edit) return { ok: false, error: "You do not have permission to change Ticket status." };
  try { await context.services.tickets.updateStatus(ticketId, { status }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function updateTicketPriorityAction(ticketId: string, priority: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.edit) return { ok: false, error: "You do not have permission to change Ticket priority." };
  try { await context.services.tickets.updatePriority(ticketId, { priority }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

export async function assignTicketAction(ticketId: string, profileId: string | null): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.assign) return { ok: false, error: "You do not have permission to assign Tickets." };
  try { await context.services.tickets.assign(ticketId, { assigned_to_profile_id: profileId }, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

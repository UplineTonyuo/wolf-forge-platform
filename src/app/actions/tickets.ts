"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { TicketDetail, TicketInboxPage } from "../../domain/tickets/schema";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import { toClientSafeError } from "../../lib/errors/application-error";
import { TICKET_ATTACHMENT_MAX_BYTES, validateTicketAttachment } from "../../lib/tickets/ticket-attachment-file";
import { validateTicketVoiceFile } from "../../lib/tickets/ticket-voice-file";
import { readServerEnvironment } from "../../lib/env/server-env";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";
import { TicketAttachmentStorageRepository } from "../../repositories/ticket-attachment-storage-repository";

export type TicketMutationResult = { ok: true } | { ok: false; error: string; code?: string };

const failure = (error: unknown): TicketMutationResult => {
  const safe = toClientSafeError(error);
  return { ok: false, error: safe.message, code: safe.code };
};

function refreshTicket(ticketId: string) {
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/account/messages");
  revalidatePath(`/account/messages/${ticketId}`);
  // The rail's "waiting on you" count and the Dashboard both read ticket state,
  // so a reply has to refresh the portal shell as well as the conversation.
  revalidatePath("/account");
  // Investment Intent reports whether a conversation is live, so a Ticket that
  // becomes one has to refresh the workspace that decides between Create and
  // Open. A no-op for every other Ticket.
  revalidatePath("/investment-intent");
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
  /**
   * `conflict` is set only when an investment conversation already exists for
   * the client + investment. It is the database's unique index answering, not
   * a guess, and it lets the caller stop pretending nothing happened instead
   * of printing a constraint message at a human.
   */
  | { ok: false; error: string; conflict?: true };

export async function createInternalTicketAction(input: {
  requestId: string;
  companyId: string;
  subject: string;
  message: string;
  priority: string;
  /**
   * Supplied only by the Investment Intent workspace, to open an investment
   * conversation. Absent for every ordinary Ticket caller, which keeps this one
   * authoritative creation path rather than adding a second endpoint.
   */
  investmentServiceId?: string;
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
        investment_service_id: input.investmentServiceId,
      },
      context.actor,
    );

    refreshTicket(ticket.id);

    return {
      ok: true,
      ticketId: ticket.id,
    };
  } catch (error) {
    const safe = toClientSafeError(error);

    /*
     * Two staff can press Create at the same moment. The partial unique index
     * is the guard and it wins the race honestly -- so the loser is told what
     * actually happened and asked to reload, rather than shown a constraint
     * violation. Scoped to investment conversations only: every other Ticket
     * failure still reports exactly what it always did.
     */
    if (input.investmentServiceId && safe.code === "CONFLICT") {
      return {
        ok: false,
        conflict: true,
        error:
          "This client already has an investment conversation for this investment. Reloading the latest state.",
      };
    }

    return {
      ok: false,
      error: safe.message,
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
  replyTo?: { ticketId: string; messageId: string; attachmentId?: string | null } | null;
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

  const target = input.target.kind === "order"
    ? { ticket_id: null, order_id: input.target.orderId }
    : input.replyTo
      ? { ticket_id: input.replyTo.ticketId, order_id: null }
      : { ticket_id: input.target.ticketId, order_id: null };

  try {
    if (file) {
      const isVoice = file.type.toLowerCase().startsWith("audio/");
      if (isVoice && (input.target.kind !== "ticket" || input.target.ticketId !== target.ticket_id)) {
        return { ok: false, error: "Voice messages are available only in Ticket conversations." };
      }
      const attachmentTarget = {
        request_id: input.requestId,
        ...target,
        reply_to_message_id: input.replyTo?.messageId ?? null,
      };
      // Admit voice attempts before parsing so rejected media still spends the existing upload quota.
      const voiceClaim = isVoice ? await context.services.tickets.prepareAttachment(attachmentTarget, context.actor) : null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validated = isVoice ? await validateTicketVoiceFile(file, bytes) : validateTicketAttachment(file, bytes);
      if (!validated.ok) return { ok: false, error: validated.error };

      const claim = voiceClaim ?? await context.services.tickets.prepareAttachment(attachmentTarget, context.actor);
      const storage = new TicketAttachmentStorageRepository(
        createTrustedServerSupabaseClient(readServerEnvironment()),
      );
      const checksum = storage.checksum(bytes);

      await storage.storeOrConfirm(claim.storage_key, bytes, validated.mimeType, checksum);

      // Another finalization may have accepted these bytes; never delete them on a refused retry.
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
    } else if (input.replyTo && input.target.kind === "order") {
      await context.services.tickets.replyToOrderMessage(input.target.orderId, {
        request_id: input.requestId,
        body,
        reply_to_message_id: input.replyTo.messageId,
        reply_to_attachment_id: input.replyTo.attachmentId ?? null,
      }, context.actor);
    } else if (input.replyTo) {
      await context.services.tickets.replyToMessage(input.replyTo.ticketId, {
        request_id: input.requestId,
        body,
        reply_to_message_id: input.replyTo.messageId,
        reply_to_attachment_id: input.replyTo.attachmentId ?? null,
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

/**
 * The client's half of the same boundary.
 *
 * `app_toggle_ticket_message_reaction` already derives the actor from
 * `auth.uid()`, requires `tickets.reply` (which the client role holds), checks
 * Ticket access, and refuses a client actor any message outside
 * `visibility = 'client'`. So this is the identical server-side operation on
 * the identical RPC — only the acting context differs. Reactions are shared
 * conversation state either way; nothing here is local to one viewer.
 */
export async function toggleClientTicketMessageReactionAction(
  messageId: string,
  reactionCode: string,
): Promise<TicketMutationResult> {
  const context = await getClientContext();
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

export async function toggleOrderMessageReactionAction(
  orderId: string,
  messageId: string,
  reactionCode: string,
): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.reply) {
    return { ok: false, error: "You do not have permission to react to Project messages." };
  }
  try {
    await context.services.tickets.toggleOrderReaction(orderId, {
      message_id: messageId,
      reaction_code: reactionCode,
    }, context.actor);
  } catch (error) {
    return failure(error);
  }
  return { ok: true };
}

export async function toggleClientOrderMessageReactionAction(
  orderId: string,
  messageId: string,
  reactionCode: string,
): Promise<TicketMutationResult> {
  const context = await getClientContext();
  try {
    await context.services.tickets.toggleOrderReaction(orderId, {
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

export type TicketSummariesResult = { ok: true; data: TicketInboxPage } | { ok: false; error: string; code?: string };

/**
 * Backs the Inbox drawer's Tickets pane list: the accessible Tickets whose
 * conversation is durably in the Inbox (tickets.inbox_added_at is not null),
 * never Tickets that are only managed from /tickets.
 */
export async function listTicketSummariesAction(page = 1, search = ""): Promise<TicketSummariesResult> {
  try {
    const context = await getInternalContext();
    if (!context.user.tickets.view) return { ok: false, error: "You do not have permission to view Tickets.", code: "PERMISSION_DENIED" };
    if (!Number.isSafeInteger(page) || page < 1 || page > 2147483647 || typeof search !== "string") {
      return { ok: false, error: "Invalid ticket page or search." };
    }
    return { ok: true, data: await context.services.tickets.listInbox(page, search.trim()) };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error) as TicketSummariesResult;
  }
}

export type TicketInboxConversationResult = { ok: true; data: TicketDetail } | { ok: false; error: string; code?: string };

/**
 * Backs a selected Ticket row inside the Inbox drawer. Same read as
 * /tickets/[ticketId]'s own `context.services.tickets.get(id)` call, just
 * reachable from a client component instead of a server render.
 */
export async function getTicketInboxConversationAction(ticketId: string): Promise<TicketInboxConversationResult> {
  try {
    const context = await getInternalContext();
    if (!context.user.tickets.view) return { ok: false, error: "You do not have permission to view this Ticket.", code: "PERMISSION_DENIED" };
    return { ok: true, data: await context.services.tickets.get(ticketId) };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error) as TicketInboxConversationResult;
  }
}

export type TicketAssigneesResult = { ok: true; data: ServiceAssigneeOption[] } | { ok: false; error: string };

/**
 * Backs the Inbox drawer's Ticket inspector, which is a client component and
 * so cannot call `context.services.catalog.listAssignees()` directly the way
 * /tickets/[ticketId]'s server render does.
 */
export async function listTicketAssigneesAction(): Promise<TicketAssigneesResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.view) return { ok: false, error: "You do not have permission to view Tickets." };
  try {
    return { ok: true, data: await context.services.catalog.listAssignees() };
  } catch (error) {
    return failure(error) as TicketAssigneesResult;
  }
}

/**
 * Makes an existing Ticket's one canonical conversation available in the Inbox
 * Tickets pane. Copies nothing: the Ticket, its messages, attachments and
 * reactions are the same rows Inbox reads afterwards. Idempotent in the
 * database, so a double submit settles on one membership and one activity
 * record rather than two.
 */
export async function addTicketToInboxAction(ticketId: string): Promise<TicketMutationResult> {
  const context = await getInternalContext();
  if (!context.user.tickets.edit) return { ok: false, error: "You do not have permission to manage Ticket conversations." };
  try { await context.services.tickets.addToInbox(ticketId, context.actor); }
  catch (error) { return failure(error); }
  refreshTicket(ticketId);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

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

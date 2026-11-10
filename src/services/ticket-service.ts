import {
  assignTicketSchema,
  createTicketSchema,
  ticketAttachmentSubmissionSchema,
  ticketAttachmentTargetSchema,
  ticketForwardToTeamInputSchema,
  ticketMessageInputSchema,
  ticketReactionInputSchema,
  ticketReplyToMessageInputSchema,
  updateTicketPrioritySchema,
  updateTicketStatusSchema,
} from "../domain/tickets/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { TicketRepository } from "../repositories/ticket-repository";
import { orderPageInputSchema } from "../domain/orders/conversation-page";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class TicketService {
  constructor(private readonly dependencies: ServiceDependencies<TicketRepository>) {}

  getOrderPage(orderId: unknown, input: unknown = {}) {
    return this.dependencies.repository.getOrderPage(parseInput(uuidSchema, orderId), parseInput(orderPageInputSchema, input));
  }

  getOrderNotes(orderId: unknown) {
    return this.dependencies.repository.getOrderNotes(parseInput(uuidSchema, orderId));
  }

  getForOrder(orderId: unknown) {
    return this.dependencies.repository.getForOrder(parseInput(uuidSchema, orderId));
  }

  prepareAttachment(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.prepareAttachment(parseInput(ticketAttachmentTargetSchema, input));
  }

  sendWithAttachment(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.sendWithAttachment(parseInput(ticketAttachmentSubmissionSchema, input));
  }

  attachmentDownload(attachmentId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.attachmentDownload(parseInput(uuidSchema, attachmentId));
  }

  sendForOrder(orderId: unknown, input: unknown, internalNote: boolean, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.sendForOrder(
      parseInput(uuidSchema, orderId), parseInput(ticketMessageInputSchema, input), internalNote,
    );
  }

  replyToOrderMessage(orderId: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.replyToOrderMessage(
      parseInput(uuidSchema, orderId),
      parseInput(ticketReplyToMessageInputSchema, input),
    );
  }

  toggleOrderReaction(orderId: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.toggleOrderReaction(
      parseInput(uuidSchema, orderId),
      parseInput(ticketReactionInputSchema, input),
    );
  }

  replyToMessage(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.replyToMessage(
      parseInput(uuidSchema, id),
      parseInput(ticketReplyToMessageInputSchema, input),
    );
  }

  toggleReaction(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.toggleReaction(
      parseInput(ticketReactionInputSchema, input),
    );
  }

  forwardToTeam(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.forwardToTeam(
      parseInput(ticketForwardToTeamInputSchema, input),
    );
  }

  list(includeArchived = false) {
    return this.dependencies.repository.list(includeArchived);
  }

  /** Inbox-only Ticket list. See TicketRepository.listInbox. */
  listInbox() {
    return this.dependencies.repository.listInbox();
  }

  get(id: unknown) {
    return this.dependencies.repository.getById(parseInput(uuidSchema, id));
  }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createTicketSchema, input));
  }

  reply(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.reply(
      parseInput(uuidSchema, id),
      parseInput(ticketMessageInputSchema, input),
    );
  }

  addInternalNote(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.addInternalNote(
      parseInput(uuidSchema, id),
      parseInput(ticketMessageInputSchema, input),
    );
  }

  unsendInternalNote(messageId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.unsendInternalNote(parseInput(uuidSchema, messageId));
  }

  updateStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateStatus(
      parseInput(uuidSchema, id),
      parseInput(updateTicketStatusSchema, input),
    );
  }

  updatePriority(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updatePriority(
      parseInput(uuidSchema, id),
      parseInput(updateTicketPrioritySchema, input),
    );
  }

  assign(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(
      parseInput(uuidSchema, id),
      parseInput(assignTicketSchema, input),
    );
  }

  archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }

  addToInbox(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.addToInbox(parseInput(uuidSchema, id));
  }
}

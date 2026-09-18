import {
  createInvoiceSchema,
  invoicePaymentInputSchema,
  invoicePayloadSchema,
  invoiceRefundInputSchema,
  issuedInvoiceUpdateSchema,
} from "../domain/invoices/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { InvoiceRepository } from "../repositories/invoice-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class InvoiceService {
  constructor(private readonly dependencies: ServiceDependencies<InvoiceRepository>) {}

  list() { return this.dependencies.repository.list(); }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  findItemByOrderId(orderId: unknown) {
    return this.dependencies.repository.findItemByOrderId(parseInput(uuidSchema, orderId));
  }
  listForClient() { return this.dependencies.repository.listForClient(); }
  getForClient(id: unknown) {
    return this.dependencies.repository.getForClient(parseInput(uuidSchema, id));
  }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createInvoiceSchema, input));
  }

  update(id: unknown, input: unknown, actor: UserMutationActor, issued = false) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(issued ? issuedInvoiceUpdateSchema : invoicePayloadSchema, input),
    );
  }

  issue(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.issue(parseInput(uuidSchema, id));
  }

  recordPayment(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.recordPayment(parseInput(uuidSchema, id), parseInput(invoicePaymentInputSchema, input));
  }

  refund(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.refund(parseInput(uuidSchema, id), parseInput(invoiceRefundInputSchema, input));
  }

  void(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.void(parseInput(uuidSchema, id));
  }
}

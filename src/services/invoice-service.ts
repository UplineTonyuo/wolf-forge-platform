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
import { invoiceManualSettingsInputSchema,invoiceShareTokenSchema,paymentReceiptInputSchema,reviewManualPaymentClaimSchema,submitManualPaymentClaimSchema } from "../domain/invoices/manual-payments";

export class InvoiceService {
  constructor(private readonly dependencies: ServiceDependencies<InvoiceRepository>) {}

  getManualPayment(id:unknown) {return this.dependencies.repository.getManualPayment(parseInput(uuidSchema,id));}
  getManualPaymentSettings() {return this.dependencies.repository.getManualPaymentSettings();}
  saveManualPaymentSettings(input:unknown,actor:UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.saveManualPaymentSettings(parseInput(invoiceManualSettingsInputSchema,input));
  }
  preparePaymentReceipt(id:unknown,input:unknown,actor:UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.preparePaymentReceipt(parseInput(uuidSchema,id),parseInput(paymentReceiptInputSchema,input));
  }
  getPaymentReceipt(id:unknown) {return this.dependencies.repository.getPaymentReceipt(parseInput(uuidSchema,id));}
  submitManualPaymentClaim(id:unknown,input:unknown,actor:UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.submitManualPaymentClaim(parseInput(uuidSchema,id),parseInput(submitManualPaymentClaimSchema,input));
  }
  reviewManualPaymentClaim(id:unknown,input:unknown,actor:UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.reviewManualPaymentClaim(parseInput(uuidSchema,id),parseInput(reviewManualPaymentClaimSchema,input));
  }
  listShareLinks(id:unknown) {return this.dependencies.repository.listShareLinks(parseInput(uuidSchema,id));}
  createShareLink(id:unknown,requestId:unknown,tokenHash:unknown,actor:UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.createShareLink(parseInput(uuidSchema,id),parseInput(uuidSchema,requestId),parseInput(invoiceShareTokenSchema,tokenHash));
  }
  revokeShareLink(id:unknown,actor:UserMutationActor) {requireVerifiedActor(actor);return this.dependencies.repository.revokeShareLink(parseInput(uuidSchema,id));}

  list() { return this.dependencies.repository.list(); }
  workEnabled() { return this.dependencies.repository.workEnabled(); }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  findItemByOrderId(orderId: unknown) {
    return this.dependencies.repository.findItemByOrderId(parseInput(uuidSchema, orderId));
  }
  listOrderIds(invoiceId: unknown) { return this.dependencies.repository.listOrderIds(parseInput(uuidSchema, invoiceId)); }
  listForClient() { return this.dependencies.repository.listForClient(); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }
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

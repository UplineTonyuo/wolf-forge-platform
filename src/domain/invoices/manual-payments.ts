import { z } from "zod";

export const PAYMENT_RECEIPT_BUCKET="invoice-payment-receipts";
export const PAYMENT_RECEIPT_MAX_BYTES=4*1024*1024;
export const PAYMENT_RECEIPT_ACCEPT="image/png,image/jpeg,image/webp";
export const invoiceShareTokenSchema=z.string().length(64).regex(/^[a-f0-9]{64}$/);
const date=z.iso.datetime({offset:true});
const cents=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference=z.string().trim().max(200).nullable();
const paypalUrl=z.string().max(2048).refine((value)=>{
  try {
    const url=new URL(value);
    return url.protocol==="https:"&&!url.username&&!url.password&&!url.port&&!url.hash
      && ["paypal.me","www.paypal.me","paypal.com","www.paypal.com"].includes(url.hostname)
      && url.pathname.length>1;
  } catch { return false; }
},"Use an HTTPS PayPal payment link.").nullable();

export const invoiceManualSettingsSchema=z.object({enabled:z.boolean(),paypal_url:paypalUrl,instructions:z.string().max(4000)});
export const invoiceManualSettingsInputSchema=invoiceManualSettingsSchema.refine(
  (value)=>!value.enabled||Boolean(value.paypal_url||value.instructions.trim()),
  {message:"Add payment instructions or a PayPal link before enabling manual payments."},
);
export type InvoiceManualSettings=z.infer<typeof invoiceManualSettingsSchema>;
export const paymentReceiptSchema=z.object({id:z.uuid(),name:z.string().min(1).max(255),mime:z.enum(["image/png","image/jpeg","image/webp"]),size:z.number().int().positive().max(PAYMENT_RECEIPT_MAX_BYTES),path:z.string().min(1).max(500)});
export const paymentReceiptUploadSchema=paymentReceiptSchema.omit({path:true});
export const paymentReceiptInputSchema=z.object({
  request_id:z.uuid(),filename:z.string().trim().min(1).max(255).refine((name)=>!/[\u0000-\u001f\u007f/\\]/.test(name),"Use a valid filename."),
  mime_type:z.enum(["image/png","image/jpeg","image/webp"]),size_bytes:z.number().int().positive().max(PAYMENT_RECEIPT_MAX_BYTES),checksum_sha256:invoiceShareTokenSchema,
});
export const manualPaymentClaimSchema=z.object({
  id:z.uuid(),invoice_id:z.uuid(),status:z.enum(["pending","approved","rejected"]),amount_cents:cents,currency:z.string().regex(/^[A-Z]{3}$/),
  method:z.enum(["paypal","bank_transfer","other"]),reference,created_at:date,reviewed_at:date.nullable(),review_reason:z.string().nullable(),
  payment_id:z.uuid().nullable(),receipt_id:z.uuid(),receipt_name:z.string(),can_view_receipt:z.boolean(),
});
export const submitManualPaymentClaimSchema=z.object({request_id:z.uuid(),receipt_id:z.uuid(),method:z.enum(["paypal","bank_transfer","other"]),reference,expected_balance_cents:cents.positive()});
export const reviewManualPaymentClaimSchema=z.object({request_id:z.uuid(),decision:z.enum(["approve","reject"]),paid_at:date.nullable(),reference,reason:z.string().trim().max(1000).nullable()}).superRefine((value,ctx)=>{
  if(value.decision==="approve"&&(!value.paid_at||!value.reference?.trim()))ctx.addIssue({code:"custom",message:"Enter the payment date and transaction reference before approving."});
  if(value.decision==="reject"&&!value.reason?.trim())ctx.addIssue({code:"custom",message:"Explain why this payment report was rejected."});
});
export const invoiceManualPaymentSchema=z.object({settings:invoiceManualSettingsSchema,claims:z.array(manualPaymentClaimSchema).max(5),can_report:z.boolean(),can_review:z.boolean()});
export const manualPaymentReviewSchema=z.object({claim:manualPaymentClaimSchema,order_ids:z.array(z.uuid()).max(100)});
export const invoiceShareLinkSchema=z.object({id:z.uuid(),created_at:date,expires_at:date,revoked_at:date.nullable()});
export const publicInvoiceShareSchema=z.object({
  invoice:z.object({id:z.uuid(),tenant_id:z.uuid(),number:z.string(),company_name:z.string(),status:z.string(),currency:z.string().regex(/^[A-Z]{3}$/),
    subtotal_cents:cents,discount_total_cents:cents,tax_total_cents:cents,total_cents:cents,balance_due_cents:cents,
    successful_paid_cents:cents,payment_reported:z.boolean(),issued_at:date.nullable(),due_at:date.nullable(),
    items:z.array(z.object({name:z.string(),description:z.string().nullable(),quantity:z.number().int().positive(),unit_price_cents:cents,total_cents:cents})).max(100),
  }),settings:invoiceManualSettingsSchema,
});
export type InvoiceManualPayment=z.infer<typeof invoiceManualPaymentSchema>;
export type ManualPaymentClaim=z.infer<typeof manualPaymentClaimSchema>;
export type ManualPaymentClaimInput=z.infer<typeof submitManualPaymentClaimSchema>;
export type ManualPaymentReviewInput=z.infer<typeof reviewManualPaymentClaimSchema>;
export type PaymentReceiptInput=z.infer<typeof paymentReceiptInputSchema>;
export type PaymentReceipt=z.infer<typeof paymentReceiptSchema>;
export type InvoiceShareLink=z.infer<typeof invoiceShareLinkSchema>;
export type PublicInvoiceShare=z.infer<typeof publicInvoiceShareSchema>;

export function createInvoiceShareToken():string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),(value)=>value.toString(16).padStart(2,"0")).join("");
}

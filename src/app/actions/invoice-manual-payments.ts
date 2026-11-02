"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { invoiceShareTokenSchema } from "../../domain/invoices/manual-payments";
import { toClientSafeError } from "../../lib/errors/application-error";
import { canSendClientWelcomeEmail } from "../../lib/email/client-welcome-email-server";
import { getClientContext,getInternalContext } from "../../lib/supabase/next-server";

function refreshInvoice(id:string) {
  for(const path of ["/invoices",`/invoices/${id}`,"/account/invoices",`/account/invoices/${id}`,`/account/invoices/${id}/payment`,"/orders","/account/projects","/account"] )revalidatePath(path);
}
export async function submitInvoiceManualPaymentAction(invoiceId:string,input:unknown) {
  try {
    const context=await getClientContext();
    const data=await context.services.invoices.submitManualPaymentClaim(invoiceId,input,context.actor);
    refreshInvoice(invoiceId);
    return {ok:true as const,data};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function reviewInvoiceManualPaymentAction(claimId:string,input:unknown) {
  try {
    const context=await getInternalContext();
    const data=await context.services.invoices.reviewManualPaymentClaim(claimId,input,context.actor);
    refreshInvoice(data.claim.invoice_id);
    return {ok:true as const,data};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function saveInvoiceManualSettingsAction(input:unknown) {
  try {
    const context=await getInternalContext();
    const data=await context.services.invoices.saveManualPaymentSettings(input,context.actor);
    revalidatePath("/settings/billing");
    return {ok:true as const,data};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function listInvoiceShareLinksAction(invoiceId:string) {
  try {
    const context=await getInternalContext();
    return {ok:true as const,data:await context.services.invoices.listShareLinks(invoiceId)};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function createInvoiceShareLinkAction(invoiceId:string,requestId:string,token:string) {
  try {
    const context=await getInternalContext();
    const hash=createHash("sha256").update(invoiceShareTokenSchema.parse(token)).digest("hex");
    return {ok:true as const,data:await context.services.invoices.createShareLink(invoiceId,requestId,hash,context.actor)};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function revokeInvoiceShareLinkAction(linkId:string) {
  try {
    const context=await getInternalContext();
    return {ok:true as const,data:await context.services.invoices.revokeShareLink(linkId,context.actor)};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}
export async function loadInvoiceEmailTargetAction(invoiceId:string) {
  try {
    const context=await getInternalContext();
    const detail=await context.services.invoices.get(invoiceId);
    const contacts=await context.services.contacts.listForCompany(detail.invoice.company_id);
    const contact=contacts.find((value)=>value.is_primary&&value.email)??contacts.find((value)=>value.email);
    if(!contact?.email)return {ok:false as const,error:"Add an authorized client contact email before emailing this invoice."};
    return {ok:true as const,data:{contactId:contact.id,name:contact.name,email:contact.email,available:await canSendClientWelcomeEmail(context)}};
  } catch(error) {return {ok:false as const,error:toClientSafeError(error).message};}
}

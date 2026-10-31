import { createHash } from "node:crypto";
import { z } from "zod";
import { PAYMENT_RECEIPT_BUCKET,PAYMENT_RECEIPT_MAX_BYTES,paymentReceiptInputSchema,paymentReceiptSchema } from "../../../../domain/invoices/manual-payments";
import { ValidationError,toClientSafeError } from "../../../../lib/errors/application-error";
import { mapDatabaseError } from "../../../../lib/errors/map-database-error";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { validateAvatarBytes } from "../../../../lib/images/avatar-file";
import { readBoundedBytes } from "../../../../lib/security/bounded-text";
import { requestIsSameOrigin } from "../../../../lib/security/same-origin";
import { enforceServerCostLimit } from "../../../../lib/security/server-cost-limit";
import { getVerifiedSessionContext } from "../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";
import { InvoiceRepository } from "../../../../repositories/invoice-repository";
import { TicketAttachmentStorageRepository } from "../../../../repositories/ticket-attachment-storage-repository";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request,{params}:{params:Promise<{invoiceId:string}>}) {
  if(!requestIsSameOrigin(request))return Response.json({ok:false,error:"Request refused."},{status:403,headers});
  try {
    const context=await getVerifiedSessionContext();
    if(!context)return Response.json({ok:false,error:"Sign in to submit a receipt."},{status:401,headers});
    const {invoiceId}=await params;z.uuid().parse(invoiceId);
    const requestId=z.uuid().parse(request.headers.get("x-request-id"));
    const filename=decodeURIComponent(request.headers.get("x-file-name")??"").split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,255);
    if(!filename)throw new ValidationError("Choose a receipt screenshot with a filename.");
    const input=paymentReceiptInputSchema.parse({request_id:requestId,filename,mime_type:request.headers.get("x-file-mime"),size_bytes:Number(request.headers.get("x-file-size")),checksum_sha256:request.headers.get("x-file-sha256")});
    await enforceServerCostLimit({actorId:context.actor.id,action:"invoice.receipt_upload"});
    const repository=new InvoiceRepository(context.client);
    // Reserve and authorize before buffering: invalid attempts also consume the invoice's bounded slots.
    const receipt=await repository.preparePaymentReceipt(invoiceId,input);
    const body=await readBoundedBytes(request,PAYMENT_RECEIPT_MAX_BYTES,20_000);
    if(!body.ok)return Response.json({ok:false,error:body.status===413?"Receipt must be 4 MB or smaller.":"Receipt upload was interrupted. Try again."},{status:body.status,headers});
    const checked=validateAvatarBytes(body.value);
    if(!checked.ok)throw new ValidationError("Choose a PNG, JPEG or WebP receipt screenshot.");
    const checksum=createHash("sha256").update(body.value).digest("hex");
    if(checksum!==input.checksum_sha256||body.value.length!==input.size_bytes||checked.format.mimeType!==input.mime_type)throw new ValidationError("Receipt changed during upload. Select the screenshot again.");
    const trusted=createTrustedServerSupabaseClient(readServerEnvironment());
    const storage=new TicketAttachmentStorageRepository(trusted,PAYMENT_RECEIPT_BUCKET);
    await storage.storeOrConfirm(receipt.path,body.value,checked.format.mimeType,checksum);
    const current=await repository.preparePaymentReceipt(invoiceId,input);
    if(current.id!==receipt.id||current.path!==receipt.path)throw new ValidationError("Receipt upload changed. Try again.");
    const result=await trusted.rpc("app_verify_invoice_payment_receipt",{p_receipt_id:receipt.id,p_uploader_profile_id:context.actor.id,p_checksum_sha256:checksum});
    if(result.error)throw mapDatabaseError(result.error,"Receipt");
    const verified=paymentReceiptSchema.parse(result.data);
    return Response.json({ok:true,data:{id:verified.id,name:verified.name,mime:verified.mime,size:verified.size}},{headers});
  } catch(error) {
    const safe=toClientSafeError(error);
    return Response.json({ok:false,error:safe.message},{status:safe.code==="PERMISSION_DENIED"?403:safe.code==="RATE_LIMITED"?429:400,headers});
  }
}

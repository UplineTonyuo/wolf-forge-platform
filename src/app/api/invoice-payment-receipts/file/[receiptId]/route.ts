import { z } from "zod";
import { PAYMENT_RECEIPT_BUCKET,PAYMENT_RECEIPT_MAX_BYTES } from "../../../../../domain/invoices/manual-payments";
import { ValidationError,toClientSafeError } from "../../../../../lib/errors/application-error";
import { readServerEnvironment } from "../../../../../lib/env/server-env";
import { validateAvatarBytes } from "../../../../../lib/images/avatar-file";
import { enforceServerCostLimit } from "../../../../../lib/security/server-cost-limit";
import { getVerifiedSessionContext } from "../../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../../lib/supabase/trusted-server-client";
import { InvoiceRepository } from "../../../../../repositories/invoice-repository";
import { TicketAttachmentStorageRepository } from "../../../../../repositories/ticket-attachment-storage-repository";

export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{receiptId:string}>}) {
  const headers={"Cache-Control":"private, no-store"};
  try {
    const context=await getVerifiedSessionContext();
    if(!context)return new Response("Sign in to view this receipt.",{status:401,headers});
    const {receiptId}=await params;z.uuid().parse(receiptId);
    const repository=new InvoiceRepository(context.client);
    const receipt=await repository.getPaymentReceipt(receiptId);
    await enforceServerCostLimit({actorId:context.actor.id,action:"invoice.receipt_download"});
    const storage=new TicketAttachmentStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment()),PAYMENT_RECEIPT_BUCKET);
    const object=await storage.download(receipt.path);
    if(object.size>PAYMENT_RECEIPT_MAX_BYTES||object.size!==receipt.size)throw new ValidationError("Receipt is unavailable.");
    const bytes=new Uint8Array(await object.arrayBuffer());
    const checked=validateAvatarBytes(bytes);
    if(!checked.ok||checked.format.mimeType!==receipt.mime)throw new ValidationError("Receipt is unavailable.");
    const current=await repository.getPaymentReceipt(receiptId);
    if(current.id!==receipt.id||current.path!==receipt.path)throw new ValidationError("Receipt is unavailable.");
    const name=receipt.name.replace(/["\r\n\\]/g,"");
    const disposition=new URL(request.url).searchParams.get("download")==="1"?"attachment":"inline";
    return new Response(bytes,{headers:{...headers,"Content-Type":receipt.mime,"Content-Length":String(bytes.length),
      "Content-Disposition":`${disposition}; filename="${name.replace(/[^\x20-\x7e]/g,"_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"}});
  } catch(error) {
    const safe=toClientSafeError(error);
    return new Response(safe.message,{status:safe.code==="PERMISSION_DENIED"?403:safe.code==="RATE_LIMITED"?429:404,headers});
  }
}

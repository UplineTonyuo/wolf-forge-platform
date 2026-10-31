"use client";

import { CheckCircle2,Clock3,ExternalLink,FileImage,LoaderCircle } from "lucide-react";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { reviewInvoiceManualPaymentAction,saveInvoiceManualSettingsAction,submitInvoiceManualPaymentAction } from "../../app/actions/invoice-manual-payments";
import { PAYMENT_RECEIPT_ACCEPT,PAYMENT_RECEIPT_MAX_BYTES,invoiceManualSettingsInputSchema,paymentReceiptUploadSchema,type InvoiceManualPayment,type InvoiceManualSettings,type ManualPaymentClaim } from "../../domain/invoices/manual-payments";
import { validateAvatarBytes } from "../../lib/images/avatar-file";
import { formatCurrencyCents,formatDateTime } from "../../lib/format";
import { PortalDialog } from "../account/ui/portal-dialog";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import styles from "./invoice-manual-payment.module.css";

const receiptUrl=(id:string)=>`/api/invoice-payment-receipts/file/${id}`;
const methodLabel=(method:string)=>method==="paypal"?"PayPal":method==="bank_transfer"?"Bank transfer":"Other manual payment";

export function InvoiceManualPaymentPanel({invoiceId,balanceCents,currency,context}:{invoiceId:string;balanceCents:number;currency:string;context:InvoiceManualPayment}) {
  const [open,setOpen]=useState(false);
  const waiting=context.claims.find((claim)=>claim.status==="pending");
  if(!context.settings.enabled&&!context.claims.length)return null;
  return <section className={styles.panel} id="manual-payment" aria-labelledby="manual-payment-title">
    <header className={styles.heading}><div><h2 id="manual-payment-title">Manual payment</h2><p>Pay outside Wolf Forge, then submit your receipt for verification.</p></div>{balanceCents>0?<strong className={styles.amount}>{formatCurrencyCents(balanceCents,currency)}</strong>:null}</header>
    {waiting?<div className={styles.status} role="status"><Clock3 size={18} aria-hidden="true"/><div><strong>Payment reported · awaiting verification</strong>Your team will review the receipt before confirming payment. {waiting.can_view_receipt?<a href={receiptUrl(waiting.receipt_id)} target="_blank" rel="noopener noreferrer">View your receipt</a>:null}</div></div>:null}
    {context.settings.enabled&&context.can_report&&!waiting?<>
      {context.settings.instructions?<div className={styles.instructions}>{context.settings.instructions}</div>:null}
      <p className={styles.note}>Pay the full outstanding amount shown above. Reporting a payment does not deduct your Wolf Forge Balance.</p>
      <div className={styles.actions}>{context.settings.paypal_url?<a className="button-secondary" href={context.settings.paypal_url} target="_blank" rel="noopener noreferrer">Open PayPal <ExternalLink size={15} aria-hidden="true"/></a>:null}<button className="button-primary" type="button" onClick={()=>setOpen(true)}>I&apos;ve paid</button></div>
    </>:null}
    {context.claims.length?<ul className={styles.history} aria-label="Payment reports">{context.claims.map((claim)=><li key={claim.id}><div><strong>{methodLabel(claim.method)} · {formatCurrencyCents(claim.amount_cents,claim.currency)}</strong><small>{formatDateTime(claim.created_at)}{claim.status==="rejected"&&claim.review_reason?` · ${claim.review_reason}`:""}</small></div><span>{claim.status==="pending"?"Awaiting verification":claim.status==="approved"?"Payment confirmed":"Report rejected"}</span></li>)}</ul>:null}
    {open?<ReportDialog invoiceId={invoiceId} balanceCents={balanceCents} currency={currency} settings={context.settings} onClose={()=>setOpen(false)}/>:null}
  </section>;
}

function ReportDialog({invoiceId,balanceCents,currency,settings,onClose}:{invoiceId:string;balanceCents:number;currency:string;settings:InvoiceManualSettings;onClose:()=>void}) {
  const router=useRouter();
  const [method,setMethod]=useState(settings.paypal_url?"paypal":"bank_transfer");
  const [reference,setReference]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [receipt,setReceipt]=useState<{id:string;name:string}|null>(null);
  const [uploadId,setUploadId]=useState(()=>crypto.randomUUID());
  const [requestId]=useState(()=>crypto.randomUUID());
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState<string|null>(null);
  const submitting=useRef(false);
  return <PortalDialog open title="Report your payment" description={`Report your payment of ${formatCurrencyCents(balanceCents,currency)}. Your team will verify it before the invoice is marked paid.`} onClose={()=>{if(!pending)onClose();}} showClose closeOnBackdrop={false}>
    <form className={styles.form} onSubmit={(event)=>{
      event.preventDefault();if(submitting.current)return;
      if(!file&&!receipt){setError("Attach your receipt screenshot before submitting.");return;}
      submitting.current=true;setError(null);
      startTransition(async()=>{
        try {
          let uploaded=receipt;
          if(!uploaded&&file){
            if(!file.size||file.size>PAYMENT_RECEIPT_MAX_BYTES)throw new Error("Choose a screenshot of 4 MB or smaller.");
            const bytes=new Uint8Array(await file.arrayBuffer());
            const checked=validateAvatarBytes(bytes);
            if(!checked.ok)throw new Error("Choose a PNG, JPEG or WebP screenshot.");
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),(byte)=>byte.toString(16).padStart(2,"0")).join("");
            const response=await fetch(`/api/invoice-payment-receipts/${invoiceId}`,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"x-request-id":uploadId,"x-file-name":encodeURIComponent(file.name),"x-file-size":String(bytes.length),"x-file-mime":checked.format.mimeType,"x-file-sha256":hash},body:file});
            const result=await response.json();
            if(!response.ok||!result.ok)throw new Error(typeof result.error==="string"?result.error:"Receipt upload failed. Try again.");
            const validated=paymentReceiptUploadSchema.parse(result.data);
            uploaded={id:validated.id,name:validated.name};setReceipt(uploaded);
          }
          if(!uploaded)throw new Error("Attach your receipt screenshot.");
          const result=await submitInvoiceManualPaymentAction(invoiceId,{request_id:requestId,receipt_id:uploaded.id,method,reference:reference.trim()||null,expected_balance_cents:balanceCents});
          if(!result.ok){setError(`${result.error} Reload the invoice to check its latest status before retrying.`);return;}
          onClose();router.refresh();
        } catch(problem){setError(problem instanceof Error?problem.message:"Payment report failed. Reload to check its status.");}
        finally{submitting.current=false;}
      });
    }}>
      <label className={styles.field}><span>Payment method</span><AnimatedSelect name="manual_method" label="Payment method" menuLabel="Manual payment methods" value={method} onChange={setMethod} options={[{value:"paypal",label:"PayPal"},{value:"bank_transfer",label:"Bank transfer"},{value:"other",label:"Other manual payment"}]}/></label>
      <label className={styles.field}><span>Receipt screenshot <span aria-hidden="true">*</span></span><input type="file" accept={PAYMENT_RECEIPT_ACCEPT} disabled={pending} required={!receipt} onChange={(event)=>{setFile(event.target.files?.[0]??null);setReceipt(null);setUploadId(crypto.randomUUID());setError(null);}}/><small className={styles.note}>PNG, JPEG or WebP, up to 4 MB. Visible only to you and authorized payment reviewers.</small></label>
      {receipt?<p className={styles.success}><FileImage size={15} aria-hidden="true"/> {receipt.name} uploaded.</p>:null}
      <label className={styles.field}><span>Transaction reference <small>(optional)</small></span><input value={reference} onChange={(event)=>setReference(event.target.value)} maxLength={200} disabled={pending}/></label>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      <footer className={styles.actions}><button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>{pending?<><LoaderCircle className="spinner" size={16} aria-hidden="true"/>Submitting…</>:"Submit payment receipt"}</button></footer>
    </form>
  </PortalDialog>;
}

export function InvoiceManualPaymentReview({context}:{context:InvoiceManualPayment}) {
  const [selected,setSelected]=useState<ManualPaymentClaim|null>(null);
  const [success,setSuccess]=useState("");
  if(!context.claims.length)return null;
  return <section className={styles.panel} aria-label="Manual payment reports"><header className={styles.heading}><div><h2>Manual payment reports</h2><p>Verify receipt of money before confirming a payment.</p></div></header>
    {success?<p className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true"/> {success}</p>:null}
    <ul className={styles.history}>{context.claims.map((claim)=><li key={claim.id}><div><strong>{formatCurrencyCents(claim.amount_cents,claim.currency)} · {methodLabel(claim.method)}</strong><small>{formatDateTime(claim.created_at)} · {claim.status==="pending"?"Awaiting verification":claim.status}{claim.reference?` · Client reference: ${claim.reference}`:""}</small>{claim.review_reason?<small>{claim.review_reason}</small>:null}</div>{claim.status==="pending"&&context.can_review?<button type="button" className="button-primary" onClick={()=>setSelected(claim)}>Review payment</button>:claim.can_view_receipt?<a href={receiptUrl(claim.receipt_id)} target="_blank" rel="noopener noreferrer">View receipt</a>:null}</li>)}</ul>
    {selected?<ReviewDialog claim={selected} onClose={()=>setSelected(null)} onSuccess={(message)=>{setSuccess(message);setSelected(null);}}/>:null}
  </section>;
}

function ReviewDialog({claim,onClose,onSuccess}:{claim:ManualPaymentClaim;onClose:()=>void;onSuccess:(message:string)=>void}) {
  const router=useRouter();
  const [requestId]=useState(()=>crypto.randomUUID());
  const [date,setDate]=useState(()=>new Date().toLocaleDateString("en-CA"));
  const [reference,setReference]=useState("");
  const [reason,setReason]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [pending,startTransition]=useTransition();
  const locked=useRef(false);
  function review(decision:"approve"|"reject") {
    if(locked.current)return;
    if(decision==="approve"&&(!date||!reference.trim())){setError("Enter the payment date and actual transaction reference.");return;}
    if(decision==="reject"&&!reason.trim()){setError("Enter a reason so the client knows what to correct.");return;}
    locked.current=true;setError(null);
    startTransition(async()=>{try{
      const paidAt=decision==="approve"?new Date(`${date}T00:00:00`).toISOString():null;
      const result=await reviewInvoiceManualPaymentAction(claim.id,{request_id:requestId,decision,paid_at:paidAt,reference:decision==="approve"?reference.trim():null,reason:reason.trim()||null});
      if(!result.ok){setError(`${result.error} Refresh to check the latest payment state.`);return;}
      onSuccess(decision==="approve"?"Payment confirmed. Service orders are ready where applicable.":"Report rejected. The client can review your reason.");router.refresh();
    }catch{setError("The review result could not be confirmed. Refresh this invoice before retrying; your review may already be saved.");}finally{locked.current=false;}});
  }
  return <PortalDialog open title="Review manual payment" description={`${formatCurrencyCents(claim.amount_cents,claim.currency)} reported via ${methodLabel(claim.method)}. Confirm actual receipt in your payment account.`} onClose={()=>{if(!pending)onClose();}} showClose closeOnBackdrop={false} size="wide">
    <div className={styles.form}>
      {claim.can_view_receipt?<figure className={styles.receipt}><Image unoptimized src={receiptUrl(claim.receipt_id)} width={600} height={300} alt="Client payment receipt screenshot"/><figcaption><a href={`${receiptUrl(claim.receipt_id)}?download=1`}>Download receipt</a></figcaption></figure>:null}
      {claim.reference?<p className={styles.note}>Client-provided reference: {claim.reference}</p>:null}
      <label className={styles.field}><span>Date paid</span><DatePicker name="paid_at" label="Date paid" menuLabel="Payment date" value={date} onChange={setDate}/></label>
      <label className={styles.field}><span>Verified transaction reference</span><input value={reference} maxLength={200} disabled={pending} onChange={(event)=>setReference(event.target.value)}/><small className={styles.note}>Use the reference from your PayPal or bank account.</small></label>
      <label className={styles.field}><span>Review note / rejection reason</span><textarea rows={3} value={reason} maxLength={1000} disabled={pending} onChange={(event)=>setReason(event.target.value)}/></label>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      <footer className={styles.actions}><button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="button" className="button-secondary" disabled={pending} onClick={()=>review("reject")}>Reject report</button><button type="button" className="button-primary" disabled={pending} onClick={()=>review("approve")}>{pending?<><LoaderCircle size={16} className="spinner" aria-hidden="true"/>Saving…</>:"Confirm payment received"}</button></footer>
    </div>
  </PortalDialog>;
}

export function InvoiceManualPaymentSettings({initial}:{initial:InvoiceManualSettings}) {
  const [enabled,setEnabled]=useState(initial.enabled),[url,setUrl]=useState(initial.paypal_url??""),[instructions,setInstructions]=useState(initial.instructions);
  const [pending,startTransition]=useTransition(),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);
  const saving=useRef(false);
  return <section className={styles.panel}><header className={styles.heading}><div><h3>Manual invoice payments</h3><p>Publish your payment instructions. Clients submit receipts for your team to verify.</p></div></header><form className={styles.form} onSubmit={(event)=>{
    event.preventDefault();if(saving.current)return;const parsed=invoiceManualSettingsInputSchema.safeParse({enabled,paypal_url:url.trim()||null,instructions:instructions.trim()});
    if(!parsed.success){setError(parsed.error.issues[0]?.message??"Check the payment settings.");return;}
    saving.current=true;setError(null);setSaved(false);startTransition(async()=>{try{const result=await saveInvoiceManualSettingsAction(parsed.data);if(!result.ok){setError(result.error);return;}setSaved(true);}catch{setError("Saving could not be confirmed. Reload these settings to check before retrying.");}finally{saving.current=false;}});
  }}><label><input type="checkbox" checked={enabled} disabled={pending} onChange={(event)=>setEnabled(event.target.checked)}/>Enable manual payment on invoices</label>
    <label className={styles.field}><span>PayPal payment link <small>(optional)</small></span><input type="url" value={url} disabled={pending} onChange={(event)=>setUrl(event.target.value)} placeholder="https://paypal.me/yourbusiness" maxLength={2048}/></label>
    <label className={styles.field}><span>Payment instructions</span><textarea rows={5} value={instructions} disabled={pending} onChange={(event)=>setInstructions(event.target.value)} maxLength={4000} placeholder="Tell clients where to pay and which invoice reference to include."/></label>
    {error?<p role="alert" className={styles.error}>{error}</p>:null}{saved?<p role="status" className={styles.success}>Manual payment instructions saved.</p>:null}<footer className={styles.actions}><button type="submit" className="button-primary" disabled={pending}>{pending?"Saving…":"Save payment instructions"}</button></footer>
  </form></section>;
}

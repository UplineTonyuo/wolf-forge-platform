"use client";

import { Clock3,Link2,LoaderCircle,Mail,Share2,Trash2 } from "lucide-react";
import { useRef,useState,useTransition } from "react";
import { createInvoiceShareLinkAction,listInvoiceShareLinksAction,loadInvoiceEmailTargetAction,revokeInvoiceShareLinkAction } from "../../app/actions/invoice-manual-payments";
import { createInvoiceShareToken,type InvoiceShareLink } from "../../domain/invoices/manual-payments";
import { formatDateTime } from "../../lib/format";
import { PortalDialog } from "../account/ui/portal-dialog";
import { ClientEmailComposer } from "../clients/client-contact-email";
import { CopyValueButton } from "../ui/copy-value-button";
import styles from "./invoice-manual-payment.module.css";

function CopyLink({label,value,note}:{label:string;value:string;note:string}) {
  return <div><label className={styles.linkLabel} htmlFor={`invoice-link-${label.replaceAll(" ","-")}`}>{label}</label><div className={styles.linkRow}><input id={`invoice-link-${label.replaceAll(" ","-")}`} value={value} readOnly onFocus={(event)=>event.target.select()}/><CopyValueButton value={value} label={label}/></div><p className={styles.linkNote}>{note}</p></div>;
}

export function InvoiceShareButton({invoiceId,canCreate}:{invoiceId:string;canCreate:boolean}) {
  const [open,setOpen]=useState(false),[origin,setOrigin]=useState("");
  return <><button type="button" className="button-secondary" onClick={()=>{setOrigin(window.location.origin);setOpen(true);}}><Share2 size={15} aria-hidden="true"/>Share</button>{open?<ShareDialog invoiceId={invoiceId} origin={origin} canCreate={canCreate} onClose={()=>setOpen(false)}/>:null}</>;
}

function ShareDialog({invoiceId,origin,canCreate,onClose}:{invoiceId:string;origin:string;canCreate:boolean;onClose:()=>void}) {
  const [links,setLinks]=useState<InvoiceShareLink[]|null>(null),[publicLink,setPublicLink]=useState<string|null>(null);
  const generation=useRef<{token:string;requestId:string}|null>(null);
  const busy=useRef(false);
  const [generatedLinkId,setGeneratedLinkId]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const [pending,startTransition]=useTransition();
  function load() {startTransition(async()=>{try{const result=await listInvoiceShareLinksAction(invoiceId);if(result.ok)setLinks(result.data);else setError(result.error);}catch{setError("Invoice links could not be loaded. Try again.");}});}
  const privateUrl=`${origin}/view/invoices/${invoiceId}`;
  const paymentUrl=`${origin}/pay/invoices/${invoiceId}`;
  return <PortalDialog open title="Share invoice" description="Choose the link your client needs." onClose={()=>{if(!pending)onClose();}} showClose closeOnBackdrop={false}>
    <div className={styles.links}>
      <CopyLink label="Private invoice link" value={privateUrl} note="The client signs in to view their invoice."/>
      <CopyLink label="Payment link" value={paymentUrl} note="Opens the client's payment options after sign-in."/>
      <div><span className={styles.linkLabel}>Public invoice link</span><p className={styles.linkNote}>Anyone with this link can view the invoice and payment instructions. Receipt submission requires client sign-in.</p>
        {publicLink?<CopyLink label="New public link" value={publicLink} note="Copy this link before closing. It expires in 30 days and can be revoked below."/>:null}
        <div className={styles.actions}><button type="button" className="button-secondary" disabled={pending} onClick={load}>{pending&&links===null?"Loading…":"Manage existing links"}</button>{canCreate?<button type="button" className="button-primary" disabled={pending||Boolean(publicLink)} onClick={()=>{
          if(busy.current)return;busy.current=true;
          const next=generation.current??{token:createInvoiceShareToken(),requestId:crypto.randomUUID()};generation.current=next;setError(null);
          startTransition(async()=>{try{const result=await createInvoiceShareLinkAction(invoiceId,next.requestId,next.token);if(!result.ok){setError(result.error);return;}
            if(result.data.revoked_at||new Date(result.data.expires_at)<=new Date()){generation.current=null;setError("That link is no longer active. Create a new link.");return;}
            setGeneratedLinkId(result.data.id);setPublicLink(`${origin}/share/invoices/${next.token}`);setLinks((current)=>[result.data,...(current??[]).filter((link)=>link.id!==result.data.id)]);
          }catch{setError("Link creation could not be confirmed. Retry this request before creating another link.");}finally{busy.current=false;}});
        }}>{pending?<LoaderCircle size={15} className="spinner" aria-hidden="true"/>:<Link2 size={15} aria-hidden="true"/>}Create public link</button>:null}</div>
      </div>
      {links?<ul className={styles.history} aria-label="Public invoice links">{links.length===0?<li>No public links created.</li>:links.map((link)=><li key={link.id}><div><strong>{link.revoked_at?"Revoked":new Date(link.expires_at)>new Date()?"Active public link":"Expired"}</strong><small><Clock3 size={12} aria-hidden="true"/> Expires {formatDateTime(link.expires_at)}</small></div>{!link.revoked_at?<button type="button" className="button-secondary" disabled={pending} onClick={()=>{if(busy.current)return;busy.current=true;setError(null);startTransition(async()=>{try{const result=await revokeInvoiceShareLinkAction(link.id);if(!result.ok){setError(result.error);return;}setLinks((current)=>current?.map((value)=>value.id===link.id?result.data:value)??[]);if(generatedLinkId===link.id){setPublicLink(null);setGeneratedLinkId(null);generation.current=null;}}catch{setError("Revocation could not be confirmed. Reload the link list before retrying.");}finally{busy.current=false;}});}}><Trash2 size={14} aria-hidden="true"/>Revoke</button>:null}</li>)}</ul>:null}
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      <footer className={styles.actions}><button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Done</button></footer>
    </div>
  </PortalDialog>;
}

export function InvoiceEmailAction({invoiceId,invoiceLabel}:{invoiceId:string;invoiceLabel:string}) {
  const [target,setTarget]=useState<{contactId:string;name:string;email:string;available:boolean}|null>(null),[error,setError]=useState<string|null>(null),[body,setBody]=useState("");
  const [pending,startTransition]=useTransition();
  return <><button type="button" className={styles.menuItem} disabled={pending} onClick={(event)=>{
    const details=event.currentTarget.closest("details");details?.removeAttribute("open");details?.querySelector<HTMLElement>("summary")?.focus();
    const base=`${window.location.origin}/view/invoices/${invoiceId}`;
    setBody(`You can view ${invoiceLabel} here:\n${base}\n\nPayment options:\n${window.location.origin}/pay/invoices/${invoiceId}`);
    startTransition(async()=>{try{const result=await loadInvoiceEmailTargetAction(invoiceId);if(result.ok)setTarget(result.data);else setError(result.error);}catch{setError("Email details could not be loaded. Try again.");}});
  }}><Mail size={15} aria-hidden="true"/>{pending?"Loading email…":"Email invoice"}</button>
    {target?<ClientEmailComposer {...target} initialSubject={`${invoiceLabel} · Wolf Forge`} initialBody={body} onClose={()=>setTarget(null)}/>:null}
    {error?<PortalDialog open title="Email invoice" onClose={()=>setError(null)} showClose><p className={styles.error} role="alert">{error}</p></PortalDialog>:null}
  </>;
}

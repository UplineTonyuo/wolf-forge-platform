"use client";
import { Phone,Video } from "lucide-react";
import { useEffect,useState,useSyncExternalStore } from "react";
import { useInboxCalls } from "../calls/call-provider";
import { CallPrepare } from "../calls/call-prepare";
import styles from "../calls/calls.module.css";
export function TicketCallControls({ticketId,disabled=false}:{ticketId:string;disabled?:boolean}){
 const controller=useInboxCalls();
 return controller?<Controls key={ticketId} ticketId={ticketId} disabled={disabled}/>:null;
}
export function OrderCallControls({orderId,disabled=false}:{orderId:string;disabled?:boolean}){
 const controller=useInboxCalls();
 return controller?<Controls key={`order:${orderId}`} ticketId={orderId} order disabled={disabled}/>:null;
}
function Controls({ticketId,disabled,order=false}:{ticketId:string;disabled:boolean;order?:boolean}){
 const controller=useInboxCalls()!;const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
 const [enabled,setEnabled]=useState(false);
 const [preparing,setPreparing]=useState<"audio"|"video"|null>(null);
 useEffect(()=>{
  let stopped=false;let last=0;let liveEnabled=true;
  const check=async()=>{if(Date.now()-last<5000)return;last=Date.now();const data=await controller.refresh(order?{order_id:ticketId}:{ticket_id:ticketId});if(!stopped){liveEnabled=Boolean(data?.enabled);setEnabled(liveEnabled);}};
  void check();const live=(event:Event)=>{if(liveEnabled&&(event as CustomEvent).detail===ticketId)void check();};
  const recover=()=>{if(document.visibilityState==="visible"){last=0;void check();}};
  window.addEventListener("wolf-forge-ticket-live",live);window.addEventListener("online",recover);document.addEventListener("visibilitychange",recover);
  return()=>{stopped=true;window.removeEventListener("wolf-forge-ticket-live",live);window.removeEventListener("online",recover);document.removeEventListener("visibilitychange",recover);};
 },[controller,ticketId,order]);
 if(!enabled)return null;
 const active=state.call&&state.call.state!=="ended";
 if(active&&preparing)setPreparing(null);
 return <div className={styles.controlsBar} aria-label="Conversation calls">
  {active?<button type="button" aria-label="Open current call" title="Open current call" onClick={()=>controller.minimize(false)}><Phone aria-hidden="true"/></button>:<><button type="button" aria-label="Voice call" title="Voice call" disabled={disabled||state.busy} onClick={()=>setPreparing("audio")}><Phone aria-hidden="true"/></button><button type="button" aria-label="Video call" title="Video call" disabled={disabled||state.busy} onClick={()=>setPreparing("video")}><Video aria-hidden="true"/></button></>}
  {preparing&&!active?<CallPrepare ticketId={ticketId} order={order} mode={preparing} controller={controller} onClose={()=>setPreparing(null)}/>:null}
  {state.error&&!state.call?<p role="alert">{state.error}</p>:null}
 </div>;
}

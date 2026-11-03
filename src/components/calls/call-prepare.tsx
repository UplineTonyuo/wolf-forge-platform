"use client";
import { useEffect,useState } from "react";
import { Phone,Mic,Video } from "lucide-react";
import type { CallAvailability } from "../../domain/tickets/calls";
import { PortalDialog } from "../account/ui/portal-dialog";
import { AnimatedSelect } from "../ui/animated-select";
import type { CallController } from "./call-controller";
import { LocalCallPreview,type CallDevicePreferences } from "./call-preview";
import { Portrait,VideoTrack } from "./call-screen";
import styles from "./calls.module.css";
export function CallPrepare({ticketId,mode,controller,onClose}:{ticketId:string;mode:"audio"|"video";controller:CallController;onClose:()=>void}){
 const [preview]=useState(()=>new LocalCallPreview());const [availability,setAvailability]=useState<CallAvailability|null>(null);
 const [stream,setStream]=useState<MediaStream|null>(null),[devices,setDevices]=useState<MediaDeviceInfo[]>([]);
 const [choices,setChoices]=useState<CallDevicePreferences>({}),[busy,setBusy]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;void controller.prepare(ticketId).then(data=>{if(current)setAvailability(data);}).catch(()=>{if(current)setError("Could not confirm who is available. Retry before calling.");});return()=>{current=false;preview.stop();};},[controller,ticketId,preview,retry]);
 const check=async(next=choices)=>{
  setBusy(true);setError("");setStream(null);
  try{const value=await preview.start(mode,next);if(value){setStream(value);setChoices(next);setDevices(await navigator.mediaDevices.enumerateDevices());}}
  catch{setError("Could not access your devices. Allow microphone/camera access in site settings, close other apps using them, then check again.");}
  finally{setBusy(false);}
 };
 const cancel=()=>{preview.stop();if(starting)void controller.end();onClose();};
 const ready=!!stream?.getAudioTracks().some(t=>t.readyState==="live")&&(mode==="audio"||!!stream.getVideoTracks().some(t=>t.readyState==="live"));
 const start=async()=>{if(!ready||busy||starting)return;setStarting(true);preview.stop();setStream(null);await controller.request(ticketId,mode,choices);onClose();};
 return <PortalDialog open onClose={cancel} title={`Start ${mode==="audio"?"voice":"video"} call`} description="Check your devices before ringing" size="wide" closeOnBackdrop={false} showClose>
  <div className={styles.screen}>
   <div className={styles.person}><Portrait name={availability?.peer?.name??"Conversation participant"} url={availability?.peer?.avatarUrl}/><h2>{availability?.peer?.name??"Checking conversation…"}</h2><p>{mode==="audio"?"Voice only · Your camera stays off":"Video call · Private conversation"}</p></div>
   {stream&&mode==="video"?<div className={styles.stage}><VideoTrack track={stream.getVideoTracks()[0]??null} local/></div>:null}
   {error?<p className={styles.error} role="alert">{error}</p>:null}
   {availability&&!availability.enabled?<p role="status">Calling is unavailable. Please send a message instead.</p>:null}
   <div className={styles.controls}>
    <button type="button" onClick={cancel}>Cancel</button>
    {!availability&&error?<button type="button" onClick={()=>{setError("");setRetry(n=>n+1);}}>Retry</button>:null}
    <button type="button" disabled={busy||starting||!availability?.enabled||!availability.peer} onClick={()=>void check()}>{mode==="audio"?<Mic aria-hidden="true"/>:<Video aria-hidden="true"/>}{busy?"Checking devices…":ready?"Check again":mode==="audio"?"Check microphone":"Preview camera and microphone"}</button>
    <button type="button" className={styles.answer} disabled={!ready||busy||starting||!availability?.enabled||!availability.peer} onClick={()=>void start()}><Phone aria-hidden="true"/>{starting?"Calling…":"Start call"}</button>
   </div>
   {ready?<p className={styles.note} role="status">{mode==="audio"?"Microphone ready.":"Camera and microphone ready."} No call has started.</p>:null}
   {devices.length?<div className={styles.devices}><div>{(["audioinput","videoinput"] as const).filter(kind=>kind!=="videoinput"||mode==="video").map(kind=><AnimatedSelect key={kind} name={`prepare-${kind}`} label={kind==="audioinput"?"Microphone":"Camera"} menuLabel="Choose a preview device" disabled={busy||starting} value={kind==="audioinput"?choices.audioDeviceId??"":choices.videoDeviceId??""} options={[{value:"",label:"System default"},...devices.filter(d=>d.kind===kind).map((d,i)=>({value:d.deviceId,label:d.label||`Device ${i+1}`}))]} onChange={id=>void check({...choices,...(kind==="audioinput"?{audioDeviceId:id}:{videoDeviceId:id})})}/>)}</div></div>:null}
  </div>
 </PortalDialog>;
}

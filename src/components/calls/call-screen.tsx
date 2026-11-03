"use client";
import { useEffect,useRef,useState } from "react";
import { Mic,MicOff,Video,VideoOff,Phone,PhoneOff,Minimize2,Headphones } from "lucide-react";
import { PortalDialog } from "../account/ui/portal-dialog";
import { AnimatedSelect } from "../ui/animated-select";
import type { CallController,CallState } from "./call-controller";
import type { CallMedia,MediaState } from "./call-media";
import styles from "./calls.module.css";

export function VideoTrack({track,local=false}:{track:MediaStreamTrack|null;local?:boolean}){
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const node=ref.current;if(!node)return;node.srcObject=track?new MediaStream([track]):null;void node.play().catch(()=>{});return()=>{node.srcObject=null;};},[track]);
 return <video ref={ref} autoPlay playsInline muted className={local?styles.localVideo:styles.video} aria-label={local?"Your camera":"Participant camera"}/>;
}
export function Portrait({name,url}:{name:string;url?:string|null}){
 const [failed,setFailed]=useState(false);
 return <span className={styles.portrait}>{url&&!failed?/* eslint-disable-next-line @next/next/no-img-element -- Authorized participant avatar; never fetched by the server. */
 <img src={url} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:name.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join("")}</span>;
}
export function CallScreen({state,controller,media,mediaState,now,playBlocked=false,onPlay}:{state:CallState;controller:CallController;media:CallMedia;mediaState:MediaState;now:number;playBlocked?:boolean;onPlay?:()=>void}){
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);const [selected,setSelected]=useState<Record<string,string>>({});
 const call=state.call;if(!call)return null;
 const incoming=call.state==="ringing"&&call.calleeId===controller.profileId;
 const ended=call.state==="ended";const connected=mediaState.state==="connected"&&mediaState.peerPresent;
 const name=state.peer?.name??"Conversation participant";
 const status=ended?(call.message??(call.outcome==="missed"?"Missed call":call.outcome==="declined"?"Call declined":"Call ended"))
  :incoming?`Incoming ${call.mode==="audio"?"voice":"video"} call`:call.state==="ringing"?"Calling…"
  :mediaState.state==="reconnecting"?"Reconnecting…":connected?"Connected":mediaState.state==="connecting"?"Connecting…":"Waiting for the other person";
 const deadline=call.state==="ringing"?call.ringDeadline??call.expiresAt:call.expiresAt;
 const remaining=now?Math.max(0,Math.ceil((Date.parse(deadline)-now)/1000)):call.state==="ringing"?40:900;
 const clock=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}`;
 const elapsed=now&&mediaState.connectedAt?Math.max(0,Math.floor((now-mediaState.connectedAt)/1000)):null;
 const deviceMenu=async()=>{try{setDevices(await navigator.mediaDevices.enumerateDevices());}catch{controller.error("Device list unavailable. Check your browser permissions.");}};
 return <>
  {state.minimized&&!ended?<button type="button" className={styles.strip} onClick={()=>controller.minimize(false)}><Phone aria-hidden="true"/><span>{name} · {status}</span><strong>{clock}</strong></button>:null}
  <PortalDialog open={!state.minimized} onClose={controller.close} title={call.mode==="audio"?"Voice call":"Video call"} description="Wolf Forge · Private conversation" size="wide" closeOnBackdrop={false} showClose={ended}
   headerAction={!ended?<button type="button" className={styles.minimize} aria-label="Minimize call" onClick={()=>controller.minimize()}><Minimize2 aria-hidden="true"/></button>:undefined}>
   <div className={styles.screen}>
    <div className={styles.status}><span className={connected?styles.live:styles.dot}/><span role="status">{status}</span>{elapsed!==null?<span>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,"0")} elapsed</span>:null}{!ended?<span className={styles.clock}>{clock} {incoming?"to answer":"left"}</span>:null}</div>
    <div className={styles.stage} data-video={!!mediaState.remoteVideo}>
     {call.mode==="video"&&mediaState.remoteVideo?<VideoTrack track={mediaState.remoteVideo}/>:<div className={styles.person}><Portrait key={`${name}:${state.peer?.avatarUrl}`} name={name} url={state.peer?.avatarUrl}/><h2>{name}</h2><p>{call.mode==="audio"?"Voice only · Camera stays off":!ended?"Camera will appear when connected":""}</p></div>}
     {call.mode==="video"&&mediaState.localVideo?<div className={styles.preview}><VideoTrack track={mediaState.localVideo} local/><span>You</span></div>:null}
     {connected&&call.mode==="audio"?<span className={styles.level} role="img" aria-label="Microphone activity"><span style={{transform:`scaleX(${mediaState.micOn?mediaState.audioLevel:0})`}}/></span>:null}
    </div>
    {state.error||mediaState.error?<p className={styles.error} role="alert">{state.error||mediaState.error}</p>:null}
    <div className={styles.controls}>
     {playBlocked&&!ended?<button type="button" onClick={onPlay}>Tap to hear the call</button>:null}
     {incoming?<><button type="button" className={styles.answer} disabled={state.busy} onClick={()=>void controller.command("accept")}><Phone aria-hidden="true"/>Answer</button><button type="button" className={styles.end} disabled={state.busy} onClick={()=>void controller.command("decline")}><PhoneOff aria-hidden="true"/>Decline</button></>:ended?<button type="button" onClick={controller.close}>Close</button>:<>
      {mediaState.state==="connected"||mediaState.state==="reconnecting"?<><button type="button" aria-pressed={!mediaState.micOn} aria-label={mediaState.micOn?"Mute microphone":"Unmute microphone"} onClick={()=>media.mic()}>{mediaState.micOn?<Mic aria-hidden="true"/>:<MicOff aria-hidden="true"/>}<span>{mediaState.micOn?"Mute":"Unmute"}</span></button>
       {call.mode==="video"?<button type="button" aria-pressed={mediaState.cameraOn} aria-label={mediaState.cameraOn?"Turn camera off":"Turn camera on"} onClick={()=>media.camera()}>{mediaState.cameraOn?<Video aria-hidden="true"/>:<VideoOff aria-hidden="true"/>}<span>Camera</span></button>:null}</>:null}
      {call.state!=="ringing"&&(!state.canJoin||mediaState.state==="error"||!!mediaState.error)?<button type="button" disabled={state.busy} onClick={()=>controller.allowJoin()}><Phone aria-hidden="true"/>{mediaState.state==="error"||mediaState.error?"Reconnect":"Continue on this device"}</button>:null}
      <button type="button" className={styles.end} disabled={state.busy} onClick={()=>void controller.end()}><PhoneOff aria-hidden="true"/>{call.state==="ringing"?"Cancel call":"End call"}</button>
     </>}
    </div>
    {!ended&&mediaState.state==="connected"?<details className={styles.devices} onToggle={event=>{if(event.currentTarget.open)void deviceMenu();}}><summary><Headphones aria-hidden="true"/>Device settings</summary><div>
     {(["audioinput","videoinput","audiooutput"] as const).filter(kind=>kind!=="videoinput"||call.mode==="video").map(kind=>{
      const label=kind==="audioinput"?"Microphone":kind==="videoinput"?"Camera":"Speaker";const choices=devices.filter(d=>d.kind===kind);
      return choices.length?<AnimatedSelect key={kind} name={`call-${kind}`} label={label} menuLabel={`Choose ${label.toLowerCase()}`} value={selected[kind]??""} options={[{value:"",label:`System ${label.toLowerCase()}`},...choices.map((d,i)=>({value:d.deviceId,label:d.label||`${label} ${i+1}`}))]} onChange={id=>{void media.device(kind,id).then(ok=>{if(ok)setSelected(v=>({...v,[kind]:id}));});}}/>:null;
     })}
    </div></details>:null}
   </div>
  </PortalDialog>
 </>;
}

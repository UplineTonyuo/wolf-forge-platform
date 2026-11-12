"use client";
import { useEffect,useRef,useState } from "react";
import { Mic,MicOff,Video,VideoOff,Phone,PhoneOff,Minimize2,Headphones } from "lucide-react";
import { PortalDialog } from "../account/ui/portal-dialog";
import { AnimatedSelect } from "../ui/animated-select";
import { AccountAvatar } from "../ui/account-avatar";
import type { CallController,CallState } from "./call-controller";
import type { CallMedia,MediaState } from "./call-media";
import styles from "./calls.module.css";
import { FloatingCallWindow } from "./floating-call-window";

export function VideoTrack({track,local=false}:{track:MediaStreamTrack|null;local?:boolean}){
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const node=ref.current;if(!node)return;node.srcObject=track?new MediaStream([track]):null;void node.play().catch(()=>{});return()=>{node.srcObject=null;};},[track]);
 return <video ref={ref} autoPlay playsInline muted className={local?styles.localVideo:styles.video} aria-label={local?"Your camera":"Participant camera"}/>;
}
export function Portrait({name,url}:{name:string;url?:string|null}){
 return <AccountAvatar name={name} avatarUrl={url} size={100} onNavy className={styles.portrait} fallback={<span aria-hidden="true">{name.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join("")}</span>}/>;
}
export function CallScreen({state,controller,media,mediaState,now,playBlocked=false,onPlay,ringBlocked=false,onRing}:{state:CallState;controller:CallController;media:CallMedia;mediaState:MediaState;now:number;playBlocked?:boolean;onPlay?:()=>void;ringBlocked?:boolean;onRing?:()=>void}){
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
 const manual=call.durationPolicy==="manual";const started=call.answeredAt?Date.parse(call.answeredAt):manual?null:mediaState.connectedAt;
 const elapsed=now&&started&&Number.isFinite(started)?Math.max(0,Math.floor((now-started)/1000)):null;
 const elapsedClock=elapsed===null?null:`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`;
 const deviceMenu=async()=>{try{setDevices(await navigator.mediaDevices.enumerateDevices());}catch{controller.error("Device list unavailable. Check your browser permissions.");}};
 return <>
  {call.mode==="video"&&!ended&&!incoming?<FloatingCallWindow key={call.id} visible={state.minimized} name={name} clock={manual?elapsedClock??"Connecting…":clock} micOn={mediaState.micOn} busy={state.busy} onMute={()=>{void media.mic();}} onEnd={()=>{void controller.end();}} onExpand={()=>controller.minimize(false)}>
   {mediaState.remoteVideo?<VideoTrack track={mediaState.remoteVideo}/>:<Portrait name={name} url={state.peer?.avatarUrl}/>}
  </FloatingCallWindow>:null}
  {call.mode==="audio"&&state.minimized&&!ended&&!incoming?<button type="button" className={styles.strip} onClick={()=>controller.minimize(false)}><Phone aria-hidden="true"/><span>{name} · {status}</span><strong>{manual?elapsedClock??"Connecting…":clock}</strong></button>:null}
  <PortalDialog open={incoming||!state.minimized} onClose={incoming?()=>{void controller.command("decline");}:controller.close} title={call.mode==="audio"?"Voice call":"Video call"} description={incoming?"Incoming call · Escape to decline":"Wolf Forge · Private conversation"} size={incoming?"default":"wide"} layer="call" closeOnBackdrop={false} showClose={ended}
   headerAction={!ended&&!incoming?<button type="button" className={styles.minimize} aria-label="Minimize call" onClick={()=>controller.minimize()}><Minimize2 aria-hidden="true"/></button>:undefined}>
   <div className={styles.screen} data-incoming={incoming||undefined}>
    <div className={styles.status}><span className={connected?styles.live:styles.dot}/><span role="status">{status}</span>{elapsedClock!==null?<span>{elapsedClock} elapsed</span>:null}{!ended&&(!manual||call.state==="ringing")?<span className={styles.clock}>{clock} {incoming?"to answer":"left"}</span>:null}</div>
    {!ended&&call.budgetWarning?<p className={styles.note} role="status" key={call.budgetWarning}>{call.budgetWarning===100?"Monthly call allowance reached. This call can continue; new calls are blocked.":`Monthly call allowance is at least ${call.budgetWarning}% used. This call can continue.`}</p>:null}
    <div className={styles.stage} data-video={!!mediaState.remoteVideo}>
     {call.mode==="video"&&mediaState.remoteVideo?<VideoTrack track={mediaState.remoteVideo}/>:<div className={styles.person}><Portrait key={`${name}:${state.peer?.avatarUrl}`} name={name} url={state.peer?.avatarUrl}/><h2>{name}</h2>{state.peer?.role?<p>{state.peer.role}</p>:null}<p>{call.mode==="audio"?"Voice only · Camera stays off":!ended?"Camera will appear when connected":""}</p></div>}
     {call.mode==="video"&&mediaState.localVideo?<div className={styles.preview}><VideoTrack track={mediaState.localVideo} local/><span>You</span></div>:null}
     {connected&&call.mode==="audio"?<span className={styles.level} role="img" aria-label="Microphone activity"><span style={{transform:`scaleX(${mediaState.micOn?mediaState.audioLevel:0})`}}/></span>:null}
    </div>
    {state.error||mediaState.error?<p className={styles.error} role="alert">{state.error||mediaState.error}</p>:null}
    {incoming&&ringBlocked?<p className={styles.note}>Your browser paused the ringtone. <button type="button" onClick={onRing}>Play ringtone</button></p>:null}
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
      const output=kind==="audiooutput";
      if(output&&(typeof HTMLMediaElement==="undefined"||!("setSinkId" in HTMLMediaElement.prototype)))return null;
      const label=kind==="audioinput"?"Microphone":kind==="videoinput"?"Camera":"Speaker";
      const choices=devices.filter(d=>d.kind===kind&&(!output||!!d.deviceId));
      const options=choices.map((d,i)=>({value:d.deviceId,label:output&&d.deviceId==="default"?"System speaker":d.label||`${label} ${i+1}`}));
      if(!output)options.unshift({value:"",label:`System ${label.toLowerCase()}`});
      const defaultId=output&&choices.some(d=>d.deviceId==="default")?"default":"";
      return choices.length?<AnimatedSelect key={kind} name={`call-${kind}`} label={label} menuLabel={`Choose ${label.toLowerCase()}`} value={selected[kind]??defaultId} options={options} onChange={id=>{void media.device(kind,id).then(ok=>{if(ok)setSelected(v=>({...v,[kind]:id}));});}}/>:null;
     })}
    </div></details>:null}
   </div>
  </PortalDialog>
 </>;
}

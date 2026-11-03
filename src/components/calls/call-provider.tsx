"use client";
import { createContext,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode } from "react";
import { z } from "zod";
import { CallController } from "./call-controller";
import { CallMedia,emptyMedia } from "./call-media";
import { CallScreen } from "./call-screen";
import styles from "./calls.module.css";
const Context=createContext<CallController|null>(null);
export const useInboxCalls=()=>useContext(Context);
const grant=z.object({callId:z.uuid(),token:z.string().max(8192),roomUrl:z.string().regex(/^https:\/\/wolfforge\.daily\.co\/wf-call-[a-f0-9-]{36}$/),mode:z.enum(["audio","video"]),expiresAt:z.iso.datetime({offset:true})});
const hint=z.object({type:z.literal("wolf-forge-call"),id:z.uuid(),version:z.number().int().positive()});
export function InboxCallProvider({profileId,children,notificationSoundEnabled=true}:{profileId:string;children:ReactNode;notificationSoundEnabled?:boolean}){
 const [controller]=useState(()=>new CallController(profileId));
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
 const [mediaState,setMediaState]=useState(emptyMedia);const [media]=useState(()=>new CallMedia(setMediaState));
 const [now,setNow]=useState(0);const audio=useRef<HTMLAudioElement>(null);const [playBlocked,setPlayBlocked]=useState(false);
 const call=state.call;const callId=call?.id,callState=call?.state,expiresAt=call?.expiresAt,acceptedAt=call?.acceptedAt;
 const ringDeadline=call?.ringDeadline;const incoming=callState==="ringing"&&call?.calleeId===profileId;
 const callMode=call?.mode,callerId=call?.callerId,calleeId=call?.calleeId;
 const ready=!!callId&&!!callState&&!["ringing","ending","ended"].includes(callState);
 useEffect(()=>{
  controller.setRelease(()=>media.stop());
  const query=new URLSearchParams(window.location.search).get("call");
  void controller.refresh(query&&z.uuid().safeParse(query).success?{call_id:query}:{});
  const versions=new Map<string,number>(),pending=new Map<string,number>();
  const message=(event:MessageEvent)=>{const value=hint.safeParse(event.data);if(!value.success)return;
   const {id,version}=value.data;if(Math.max(versions.get(id)??0,pending.get(id)??0)>=version)return;pending.set(id,version);
   // Resolve the current claim, never replace a live call with an old notification's history.
   void controller.refresh().then(data=>{if(data){versions.set(id,version);controller.minimize(false);}
    if(versions.size>50)versions.delete(versions.keys().next().value!);
   }).finally(()=>{if(pending.get(id)===version)pending.delete(id);});
  };
  navigator.serviceWorker?.addEventListener("message",message);
  const recover=()=>{if(document.visibilityState==="visible"&&navigator.onLine)void controller.refresh();};
  document.addEventListener("visibilitychange",recover);window.addEventListener("online",recover);
  const leave=()=>{void controller.end();};window.addEventListener("pagehide",leave);
  return()=>{navigator.serviceWorker?.removeEventListener("message",message);document.removeEventListener("visibilitychange",recover);window.removeEventListener("online",recover);window.removeEventListener("pagehide",leave);void controller.end();media.stop();};
 },[controller,media]);
 useEffect(()=>{
  const delay=controller.pollDelay();if(delay===null)return;
  let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
  const run=async()=>{if(stopped)return;if(document.visibilityState==="visible"&&navigator.onLine){await controller.refresh(callId?{call_id:callId}:{});if(mediaState.peerPresent)await controller.confirmPresence();}if(!stopped)timer=setTimeout(run,delay);};
  timer=setTimeout(run,delay);return()=>{stopped=true;clearTimeout(timer);};
 },[controller,callId,callState,mediaState.peerPresent]);
 useEffect(()=>{
  if(!callId||!expiresAt||callState==="ended")return;const tick=()=>{const n=Date.now();setNow(n);if(n>=Date.parse(expiresAt)||callState==="ringing"&&ringDeadline&&n>=Date.parse(ringDeadline)||acceptedAt&&callState!=="active"&&n>=Date.parse(acceptedAt)+45000)controller.expire();};
  tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
 },[controller,callId,expiresAt,acceptedAt,callState,ringDeadline]);
 useEffect(()=>{
  if(!incoming||!notificationSoundEnabled||!navigator.userActivation?.hasBeenActive)return;
  const Audio=window.AudioContext;if(!Audio)return;const context=new Audio();
  const ring=()=>{if(document.visibilityState!=="visible"||!ringDeadline||Date.now()>=Date.parse(ringDeadline)||context.state!=="running")return;
   const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=440;gain.gain.setValueAtTime(.04,context.currentTime);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+.28);oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.3);
  };
  void context.resume().then(ring).catch(()=>{});const timer=setInterval(ring,3000);return()=>{clearInterval(timer);void context.close().catch(()=>{});};
 },[incoming,ringDeadline,notificationSoundEnabled]);
 useEffect(()=>{
  if(!callId||!callMode||!callerId||!ready||!state.canJoin)return;
  let cancelled=false;const abort=new AbortController();
  const connect=async()=>{
   try{
    const response=await fetch("/api/ticket-call-media",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify({call_id:callId,device_id:controller.deviceId}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])});
    if(!response.ok)throw new Error("Media unavailable");const result=await response.json();const data=grant.parse(result.data);
    if(cancelled)return;if(!result.ok||data.callId!==callId||data.mode!==callMode||data.roomUrl!==`https://wolfforge.daily.co/wf-call-${callId}`||Date.parse(data.expiresAt)<=Date.now())throw new Error("Media unavailable");
    await media.join(data,callerId===profileId?calleeId??"":callerId,controller.getPreferences());
   }catch{if(!cancelled)controller.connectionFailed("Could not connect your devices. Check permissions, then continue on this device.");}
  };
  void connect();return()=>{cancelled=true;abort.abort();media.stop();};
 },[controller,media,callId,callMode,callerId,calleeId,ready,state.canJoin,state.joinAttempt,profileId]);
 useEffect(()=>{
  const node=audio.current;if(!node)return;node.srcObject=mediaState.remoteAudio?new MediaStream([mediaState.remoteAudio]):null;
  if(mediaState.remoteAudio)void node.play().then(()=>setPlayBlocked(false)).catch(()=>setPlayBlocked(true));
  return()=>{node.srcObject=null;};
 },[mediaState.remoteAudio]);
 return <Context.Provider value={controller}>{children}<audio ref={audio} autoPlay aria-label="Call audio"/>
  {playBlocked&&state.minimized&&call?.state!=="ended"?<button className={styles.audioPrompt} type="button" onClick={()=>void audio.current?.play().then(()=>setPlayBlocked(false)).catch(()=>controller.error("Audio playback is blocked by this browser."))}>Tap to hear the call</button>:null}
  <CallScreen state={state} controller={controller} media={media} mediaState={mediaState} now={now} playBlocked={playBlocked} onPlay={()=>void audio.current?.play().then(()=>setPlayBlocked(false)).catch(()=>controller.error("Audio playback is blocked by this browser."))}/>
 </Context.Provider>;
}

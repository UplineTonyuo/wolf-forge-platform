import type { DailyCall, DailyEvent, DailyCallFactory } from "@daily-co/daily-js";
import type { CallDevicePreferences } from "./call-preview";
export type MediaState={state:"idle"|"connecting"|"connected"|"reconnecting"|"error";localVideo:MediaStreamTrack|null;remoteVideo:MediaStreamTrack|null;remoteAudio:MediaStreamTrack|null;micOn:boolean;cameraOn:boolean;peerPresent:boolean;audioLevel:number;connectedAt:number|null;error:string};
export const emptyMedia:MediaState={state:"idle",localVideo:null,remoteVideo:null,remoteAudio:null,micOn:false,cameraOn:false,peerPresent:false,audioLevel:0,connectedAt:null,error:""};
type Grant={token:string;roomUrl:string;mode:"audio"|"video"};
export class CallMedia{
 private generation=0;private call:DailyCall|null=null;private mode:"audio"|"video"="audio";private state=emptyMedia;
 constructor(private update:(state:MediaState)=>void,private load:()=>Promise<Pick<DailyCallFactory,"createCallObject">>=async()=>(await import("@daily-co/daily-js")).default){}
 private emit(value:Partial<MediaState>){this.state={...this.state,...value};this.update(this.state);}
 async join(grant:Grant,peerId:string,devices:CallDevicePreferences={}){
  this.stop();const generation=++this.generation;this.mode=grant.mode;
  this.emit({...emptyMedia,state:"connecting"});
  try{
   const Daily=await this.load();if(generation!==this.generation)return;
   const options={audioSource:devices.audioDeviceId||true,...(grant.mode==="audio"?{videoSource:false,startVideoOff:true}:{videoSource:devices.videoDeviceId||true})};
   const call=Daily.createCallObject({subscribeToTracksAutomatically:true,...options});this.call=call;
   const current=()=>this.call===call&&generation===this.generation;
   const sync=()=>{
    if(!current())return;const people=Object.values(call.participants());const local=people.find(p=>p.local);const peers=people.filter(p=>!p.local);
    if(peers.some(p=>p.user_id!==peerId)){this.stop();this.emit({state:"error",error:"The call participant could not be verified."});return;}
    const remote=peers[0];const track=(value:typeof local,kind:"audio"|"video")=>value?.tracks[kind].state==="playable"?value.tracks[kind].track??null:null;
    this.emit({localVideo:track(local,"video"),remoteVideo:track(remote,"video"),remoteAudio:track(remote,"audio"),
     micOn:!!local?.audio&&!!track(local,"audio"),cameraOn:grant.mode==="video"&&!!local?.video&&!!track(local,"video"),peerPresent:!!remote});
   };
   for(const event of ["participant-joined","participant-updated","participant-left","track-started","track-stopped"] as DailyEvent[])call.on(event,sync);
   call.on("network-connection",event=>{if(current())this.emit({state:event?.event==="connected"?"connected":"reconnecting"});});
   call.on("error",()=>{if(current()){this.stop();this.emit({state:"error",error:"Media connection failed. Check device permissions and reconnect."});}});
   call.on("camera-error",()=>{if(current())this.emit({error:"Microphone or camera access is unavailable. Check browser permissions or select a different device."});});
   call.on("local-audio-level",event=>{if(current())this.emit({audioLevel:Math.max(0,Math.min(1,event?.audioLevel??0))});});
   call.on("left-meeting",()=>{if(current()){this.stop();this.emit({state:"error",error:"You left the media room. End the call or reconnect."});}});
   await call.join({url:grant.roomUrl,token:grant.token,...options});
   if(!current()){await call.destroy().catch(()=>{});return;}
   this.emit({state:"connected",connectedAt:Date.now()});sync();void call.startLocalAudioLevelObserver(300).catch(()=>{});
  }catch{if(generation===this.generation){this.stop();this.emit({state:"error",error:"Allow microphone and camera access, then reconnect. Your devices are off."});}}
 }
 mic(){if(this.call)this.call.setLocalAudio(!this.call.localAudio());}
 camera(){if(this.call&&this.mode==="video")this.call.setLocalVideo(!this.call.localVideo());}
 async device(kind:"audioinput"|"videoinput"|"audiooutput",id:string){
  if(!this.call || (kind==="videoinput"&&this.mode==="audio"))return false;
  try{if(kind==="audiooutput")await this.call.setOutputDeviceAsync({outputDeviceId:id});else await this.call.setInputDevicesAsync(kind==="audioinput"?{audioDeviceId:id}:{videoDeviceId:id});return true;}
  catch{this.emit({error:"That device could not be selected. Choose another device."});return false;}
 }
 stop(){this.generation++;const call=this.call;this.call=null;
  if(call){try{Object.values(call.participants()).filter(p=>p.local).forEach(p=>{for(const t of Object.values(p.tracks))(t?.persistentTrack??t?.track)?.stop();});}catch{/* Destroy also releases SDK-owned tracks. */}void call.destroy().catch(()=>{});}
  this.emit(emptyMedia);
 }
}

import { callAvailability, ticketCall, type CallAvailability, type TicketCall } from "../../domain/tickets/calls";
import { randomUuid } from "../../lib/random-uuid";
import type { CallDevicePreferences } from "./call-preview";
export type CallState={call:TicketCall|null;peer:CallAvailability["peer"];busy:boolean;error:string;minimized:boolean;canJoin:boolean;joinAttempt:number};
export class CallController{
 private state:CallState={call:null,peer:null,busy:false,error:"",minimized:false,canJoin:false,joinAttempt:0};
 private listeners=new Set<()=>void>(); private disposed=false; private reading=false; private stopping=false;
 private readDone:Promise<void>=Promise.resolve();
 private sequence=0; private requestKey:{ticket:string;mode:string;recipient?:string;id:string}|null=null;
 private terminal=new Set<string>(); readonly deviceId=randomUuid(); onRelease=()=>{};
 private preferences:CallDevicePreferences={};
 getPreferences(){return this.preferences;}
 constructor(readonly profileId:string,private send:typeof fetch=fetch){}
 snapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 setRelease(release:()=>void){this.onRelease=release;}
 private patch(value:Partial<CallState>){if(this.disposed)return;this.state={...this.state,...value};this.listeners.forEach(fn=>fn());}
 private async api(path:string,body?:unknown,keepalive=false){
  const response=await this.send(path,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",
   ...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body),keepalive}:{}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error([401,403,404].includes(response.status)?"This call is no longer available.":"Could not confirm the call. Check your connection and try again.");
  const result=await response.json();if(!result?.ok)throw new Error("Could not confirm the call.");return result.data;
 }
 private adopt(call:TicketCall|null,peer?:CallAvailability["peer"],currentClaim=false){
  const previous=this.state.call;
  if(previous&&previous.state!=="ended"&&call&&call.id!==previous.id){
   if(!currentClaim||call.state==="ended")return;
   this.onRelease();this.stopping=false;this.patch({canJoin:false});
  }
  if(call && this.terminal.has(call.id) && call.state!=="ended")return;
  if(call?.state==="ended"){this.terminal.add(call.id);this.onRelease();}
  if(this.state.call && !call && this.state.call.state!=="ended"){this.onRelease();this.patch({call:{...this.state.call,state:"ended"},canJoin:false});return;}
  if(previous?.state==="ended"&&!call)this.requestKey=null;
  this.patch({call,...(peer===undefined?(call?.id!==previous?.id?{peer:null}:{}):{peer}),...(call?.state==="ended"?{canJoin:false}:{})});
 }
 async refresh(query:{ticket_id?:string;call_id?:string}={}):Promise<CallAvailability|null>{
  if(this.disposed)return null;
  if(this.reading){await this.readDone;return this.refresh(query);}
  this.reading=true;let readFinished!:()=>void;this.readDone=new Promise(resolve=>{readFinished=resolve;});const sequence=this.sequence;
  try{
   const data=callAvailability.parse(await this.api(`/api/ticket-calls?${new URLSearchParams({action:"current",...query})}`));
   if(this.disposed || sequence!==this.sequence)return null;
   if(data.profileId!==this.profileId)throw new Error("Your account changed. Reload before calling.");
   // Looking at another conversation must not clear a call in the shared shell.
   if(!query.ticket_id || data.call || !this.state.call || this.state.call.ticketId===query.ticket_id)this.adopt(data.call,data.peer,!query.ticket_id&&!query.call_id);
   return data;
  }catch(error){if(this.state.call?.state!=="ended" && this.state.call){this.onRelease();this.patch({canJoin:false,error:error instanceof Error?error.message:"Call unavailable."});}return null;}
  finally{this.reading=false;readFinished();}
 }
 async prepare(ticket:string){const value=callAvailability.parse(await this.api(`/api/ticket-calls?action=prepare&ticket_id=${encodeURIComponent(ticket)}`));if(value.profileId!==this.profileId)throw new Error("Account changed");return value;}
 async request(ticket:string,mode:"audio"|"video",preferences:CallDevicePreferences={},recipient?:string){
  if(this.disposed || this.state.busy || (this.state.call && this.state.call.state!=="ended"))return;
  // Clear the completed attempt once; a lost response to the new attempt must retain its key.
  if(this.state.call?.state==="ended"){this.requestKey=null;this.patch({call:null,peer:null});}
  this.preferences=preferences;this.stopping=false;this.sequence++;this.patch({busy:true,error:"",minimized:false});
  if(this.requestKey?.ticket!==ticket || this.requestKey.mode!==mode || this.requestKey.recipient!==recipient)this.requestKey={ticket,mode,recipient,id:randomUuid()};
  try{
   const call=ticketCall.parse(await this.api("/api/ticket-calls",{action:"request",ticket_id:ticket,mode,request_id:this.requestKey.id,device_id:this.deviceId,...(recipient?{recipient_id:recipient}:{})}));
   if(this.disposed || this.stopping){await this.api("/api/ticket-calls",{action:"cancel",call_id:call.id},true);return;}
   this.adopt(call);this.patch({canJoin:call.state!=="ended"});await this.refresh({call_id:call.id});
  }catch(error){this.patch({error:error instanceof Error?error.message:"Call unavailable."});}
  finally{this.patch({busy:false});}
 }
 async command(action:"accept"|"decline"){
  const call=this.state.call;if(!call || this.state.busy || this.disposed)return;
  this.stopping=false;const sequence=++this.sequence;this.patch({busy:true,error:"",minimized:false});
  try{const next=ticketCall.parse(await this.api("/api/ticket-calls",{action,call_id:call.id,device_id:this.deviceId}));
   if(this.disposed||this.stopping||sequence!==this.sequence||this.state.call?.id!==call.id)return;
   this.adopt(next);this.patch({canJoin:action==="accept"&&next.state!=="ended"});}
  catch(error){this.patch({error:error instanceof Error?error.message:"Call unavailable."});}
  finally{this.patch({busy:false});}
 }
 async end(){
  this.stopping=true;this.sequence++;this.onRelease();this.patch({canJoin:false});
  const call=this.state.call;if(!call || call.state==="ended")return;
  this.patch({busy:true,error:""});
  try{await this.api("/api/ticket-calls",{action:call.state==="ringing"&&call.callerId===this.profileId?"cancel":"end",call_id:call.id},true);
   this.adopt({...call,state:"ended"});this.requestKey=null;
  }catch{this.patch({error:"Your microphone and camera are off. Could not confirm hang-up; retry End call."});}
  finally{this.patch({busy:false});}
 }
 allowJoin(){this.patch({canJoin:true,error:"",joinAttempt:this.state.joinAttempt+1});}
 minimize=(value=true)=>this.patch({minimized:value});
 close=()=>{if(!this.state.call || this.state.call.state==="ended"){if(this.state.call?.state==="ended")this.requestKey=null;this.patch({call:null,error:"",peer:null});}else this.minimize();};
 error=(message:string)=>this.patch({error:message});
 connectionFailed(message:string){this.onRelease();this.patch({canJoin:false,error:message});}
 async confirmPresence(){const call=this.state.call;if(!call||!["accepted","connecting"].includes(call.state)||!this.state.canJoin)return;
  try{const next=ticketCall.parse(await this.api("/api/ticket-call-media",{action:"presence",call_id:call.id,device_id:this.deviceId}));if(!this.stopping)this.adopt(next);}
  catch{/* Another bounded active-call tick can retry an incomplete presence snapshot. */}
 }
 pollDelay(){const c=this.state.call;return !c || c.state==="ended"?null:c.state==="active"?10000:2000;}
 expire(){if(this.stopping)return;this.onRelease();this.patch({canJoin:false,error:"This call has reached its time limit."});void this.end();}
 dispose(){this.disposed=true;this.stopping=true;this.sequence++;this.onRelease();this.listeners.clear();}
}

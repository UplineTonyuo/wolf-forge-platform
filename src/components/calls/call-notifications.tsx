"use client";
import { useEffect,useState } from "react";
import { Bell,BellOff } from "lucide-react";
import styles from "./calls.module.css";
const keyBytes=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
async function request(body?:unknown){
 const response=await fetch("/api/ticket-call-push",{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",
  ...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error("Device registration unavailable");return result.data;
}
export function CallNotifications(){
 const [config,setConfig]=useState<{publicKey:string}|null>(null);const [active,setActive]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 useEffect(()=>{
  let stopped=false;if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return;
  void (async()=>{try{
   const value=await request();if(stopped)return;if(typeof value?.publicKey!=="string"||!/^[A-Za-z0-9_-]{87}$/.test(value.publicKey))return;setConfig(value);
   const registration=await navigator.serviceWorker.getRegistration("/");const subscription=await registration?.pushManager.getSubscription();
   if(subscription){const status=await request({action:"status",endpoint:subscription.endpoint});if(!stopped)setActive(status.active===true);}
  }catch{/* Unconfigured environments remain quiet; no retry loop. */}})();
  return()=>{stopped=true;};
 },[]);
 async function toggle(){
  if(!config||busy)return;setBusy(true);setMessage("");let created:PushSubscription|null=null;
  try{
   if(!active&&await Notification.requestPermission()!=="granted"){setMessage("Allow notifications in your browser to receive incoming calls outside this conversation.");return;}
   const registration=await navigator.serviceWorker.register("/push-sw.js",{scope:"/",updateViaCache:"none"});
   await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();
   if(!subscription&&!active){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});created=subscription;}
   if(!subscription)throw new Error("Device unavailable");
   // Never unsubscribe an existing endpoint: ordinary message alerts may share it.
   await request({action:"set",endpoint:subscription.endpoint,enabled:!active});setActive(!active);
   setMessage(active?"Call alerts are off on this device.":"Call alerts are enabled on this device. Browser and system settings control delivery.");
  }catch{if(created)await created.unsubscribe().catch(()=>false);setMessage("Call alerts could not be changed. Check permissions and try again.");}
  finally{setBusy(false);}
 }
 if(!config)return <span className={styles.note}>Incoming alerts need a supported, configured device.</span>;
 return <span className={styles.notice}><button type="button" disabled={busy} aria-busy={busy} onClick={()=>void toggle()}>{active?<BellOff aria-hidden="true"/>:<Bell aria-hidden="true"/>}{busy?"Updating…":active?"Turn off call alerts":"Enable call alerts"}</button>{message?<span role="status">{message}</span>:null}</span>;
}

"use client";
import { useEffect,useRef,useState } from "react";
import { Bell,BellOff } from "lucide-react";
import styles from "./calls.module.css";
import { ensureBrowserPushSubscription } from "../../lib/notifications/browser-push-subscription";
async function request(body?:unknown){
 const response=await fetch("/api/ticket-call-push",{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",
  ...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error("Device registration unavailable");return result.data;
}
export function CallNotifications(){
 const [config,setConfig]=useState<{publicKey:string}|null>(null);const [active,setActive]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const inFlight=useRef(false);
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
  if(!config||inFlight.current)return;inFlight.current=true;setBusy(true);setMessage("");
  try{
   if(!active){
    const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
    if(permission!=="granted"){setMessage("Browser call notifications are blocked. Change this site's notification permission in browser settings, then try again. In-app call cards remain available.");return;}
   }
   const subscription=active?await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription():await ensureBrowserPushSubscription(config.publicKey);
   if(!subscription)throw new Error("Device unavailable");
   // Never unsubscribe an existing endpoint: ordinary message alerts may share it.
   await request({action:"set",endpoint:subscription.endpoint,enabled:!active});setActive(!active);
   setMessage(active?"Browser call notifications are off on this device.":"This device is registered. Browser call delivery also requires workspace push configuration and browser/system permission.");
  }catch{setMessage("Call notifications could not be changed. Check this site's browser notification settings and try again.");}
  finally{inFlight.current=false;setBusy(false);}
 }
 if(!config)return <p className={styles.note}>In-app call cards are automatic. Browser call notifications need a supported, configured device.</p>;
 return <div className={styles.notice}><p>In-app call cards are automatic. Browser notifications are optional and require permission and workspace delivery configuration.</p><button type="button" className="button-secondary" disabled={busy} aria-busy={busy} onClick={()=>void toggle()}>{active?<BellOff aria-hidden="true"/>:<Bell aria-hidden="true"/>}{busy?"Updating…":active?"Turn off browser call notifications":"Set up browser call notifications"}</button>{message?<span role="status">{message}</span>:null}</div>;
}

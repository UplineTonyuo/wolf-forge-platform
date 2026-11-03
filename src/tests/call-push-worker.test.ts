import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect,it,vi } from "vitest";
const id="71000000-0000-4000-8000-000000000001";
function fixture(active=true,open=true){
 const handlers:Record<string,(e:unknown)=>void>={};const post=vi.fn(),focus=vi.fn(),show=vi.fn(),openWindow=vi.fn();
 const send=vi.fn().mockImplementation((path:string)=>Promise.resolve(Response.json(path.includes("ticket-call-push")?{ok:true,data:{active,call:active?{id,version:1}:null}}:{active:false})));
 const self={location:{origin:"https://app.example"},addEventListener:(key:string,fn:(e:unknown)=>void)=>{handlers[key]=fn;},registration:{pushManager:{getSubscription:async()=>({endpoint:"https://fcm.googleapis.com/test"})},showNotification:show},clients:{matchAll:async()=>open?[{url:"https://app.example/orders",focus,postMessage:post}]:[],openWindow}};
 runInNewContext(readFileSync(new URL("../../public/push-sw.js",import.meta.url),"utf8"),{self,fetch:send,URL,AbortSignal});
 return {post,focus,show,openWindow,async fire(type:string){let work:Promise<void>|undefined;handlers[type]!({waitUntil:(p:Promise<void>)=>{work=p;},notification:{close:vi.fn(),data:{callId:id,version:1}}});await work;}};
}
it("shows a generic call alert and forwards only an opaque hint to app windows",async()=>{const f=fixture();await f.fire("push");expect(f.show).toHaveBeenCalledWith("Incoming call from Wolf Forge",expect.objectContaining({tag:`wolf-forge-call-${id}`}));expect(f.post).toHaveBeenCalledWith({type:"wolf-forge-call",id,version:1});});
it("never shows stale or revoked call metadata",async()=>{const f=fixture(false);await f.fire("push");expect(f.show).not.toHaveBeenCalled();expect(f.post).not.toHaveBeenCalled();});
it("focuses an existing internal window without navigating its draft",async()=>{const f=fixture();await f.fire("notificationclick");expect(f.focus).toHaveBeenCalled();expect(f.openWindow).not.toHaveBeenCalled();expect(f.post).toHaveBeenCalledWith({type:"wolf-forge-call",id,version:1});});
it("opens a bounded same-origin call entry when no app window is open",async()=>{const f=fixture(true,false);await f.fire("notificationclick");expect(f.openWindow).toHaveBeenCalledWith(`https://app.example/calls/${id}`);});

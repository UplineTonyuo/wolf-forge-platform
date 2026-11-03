/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CallNotifications } from "../components/calls/call-notifications";
vi.mock("../app/actions/push",()=>({browserPushEndpointStateAction:vi.fn(async()=>"owned")}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(["denied","default","granted"] as const)("keeps %s permission gesture-only and reuses an existing subscription",async(permission)=>{
 const requestPermission=vi.fn(async()=>"granted");vi.stubGlobal("Notification",{permission,requestPermission});vi.stubGlobal("PushManager",class {});
 const unsubscribe=vi.fn(),subscribe=vi.fn();const registration={pushManager:{getSubscription:vi.fn(async()=>({endpoint:"https://fcm.googleapis.com/synthetic",unsubscribe})),subscribe}};
 const register=vi.fn();Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{getRegistration:vi.fn(async()=>registration),ready:Promise.resolve(registration),register}});
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>Response.json({ok:true,data:init?.body?(JSON.parse(init.body as string).action==="status"?{active:false}:true):{publicKey:"A".repeat(87)}}));vi.stubGlobal("fetch",fetcher);
 render(<CallNotifications/>);const button=await screen.findByRole("button",{name:"Set up browser call notifications"});expect(requestPermission).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
 fireEvent.click(button);
 if(permission==="denied")expect(await screen.findByText(/Browser call notifications are blocked/)).toBeInTheDocument();
 else{await screen.findByText(/This device is registered/);expect(fetcher.mock.calls.filter(([,init])=>init?.body&&JSON.parse(init.body as string).action==="set")).toHaveLength(1);}
 expect(requestPermission).toHaveBeenCalledTimes(permission==="default"?1:0);expect(register).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();expect(unsubscribe).not.toHaveBeenCalled();
 await waitFor(()=>expect(button).not.toBeDisabled());
});

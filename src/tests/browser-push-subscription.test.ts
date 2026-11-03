/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({state:vi.fn()}));
vi.mock("../app/actions/push",()=>({browserPushEndpointStateAction:f.state}));
import { ensureBrowserPushSubscription } from "../lib/notifications/browser-push-subscription";
const key="A".repeat(87);
beforeEach(()=>{f.state.mockReset().mockResolvedValue("owned");});
afterEach(()=>vi.restoreAllMocks());
it("serializes simultaneous call/message setup to one browser subscription",async()=>{
 const subscription={endpoint:"https://fcm.googleapis.com/combined"} as PushSubscription;
 const subscribe=vi.fn(async()=>subscription);const registration={pushManager:{getSubscription:async()=>null,subscribe}};
 Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{getRegistration:async()=>registration,ready:Promise.resolve(registration)}});
 const [call,message]=await Promise.all([ensureBrowserPushSubscription(key),ensureBrowserPushSubscription(key)]);
 expect(call).toBe(subscription);expect(message).toBe(subscription);expect(subscribe).toHaveBeenCalledOnce();
});
it("keeps an existing same-account endpoint even when ordinary message delivery is off",async()=>{
 const unsubscribe=vi.fn();const subscription={endpoint:"https://fcm.googleapis.com/calls-only",unsubscribe};const subscribe=vi.fn();const registration={pushManager:{getSubscription:async()=>subscription,subscribe}};
 Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{getRegistration:async()=>registration,ready:Promise.resolve(registration)}});
 expect(await ensureBrowserPushSubscription(key)).toBe(subscription);expect(unsubscribe).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
});

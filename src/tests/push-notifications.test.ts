import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { allowedPushEndpoint, studioPushAvailable } from "../domain/notifications/push";
import { dispatchStudioPush, validPushEndpoint } from "../../supabase/functions/studio-web-push/handler";

const project = "https://rsnmlcyopnxucwgfttyf.supabase.co";
const endpoint = "https://fcm.googleapis.com/wp/synthetic-device";

describe("Studio push boundaries", () => {
  it.each(["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.attacker.invalid/x", "https://fcm.googleapis.com@attacker.invalid/x", "https://fcm.googleapis.com:8443/x", "https://web.push.apple.com/x#fragment", "https://169.254.169.254/latest/meta-data", "https://attacker.invalid/x"])("rejects network target %s", (target) => {
    expect(allowedPushEndpoint(target)).toBe(false);
    expect(validPushEndpoint(target)).toBe(false);
  });
  it.each([endpoint, "https://updates.push.services.mozilla.com/wpush/v2/example", "https://web.push.apple.com/example", "https://wns2-db5p.notify.windows.com/w/?token=example"])("accepts browser push provider %s", (target) => {
    expect(allowedPushEndpoint(target)).toBe(true);
    expect(validPushEndpoint(target)).toBe(true);
  });
  it("fails closed for production and unrelated backends", () => {
    expect(studioPushAvailable({ VERCEL_ENV: "preview", SUPABASE_URL: project })).toBe(true);
    expect(studioPushAvailable({ VERCEL_ENV: "production", SUPABASE_URL: project })).toBe(false);
    expect(studioPushAvailable({ VERCEL_ENV: "preview", SUPABASE_URL: "https://jwynqsyirgenqlmkooah.supabase.co" })).toBe(false);
  });
});

function dispatcherFixture(target = endpoint) {
  const rpc = vi.fn(async (name: string) => ({ data: name === "app_get_studio_push_dispatch_settings"
    ? { projectUrl: project, origin: "https://wolf-forge-platform-example-wolf-forge.vercel.app", publicKey: "public", privateKey: "private" }
    : name === "app_claim_studio_push_deliveries" ? [{ id: "delivery", attemptId: "attempt", endpoint: target }] : true, error: null }));
  const details = vi.fn<Parameters<typeof dispatchStudioPush>[1]>(() => ({ headers: { Authorization: "vapid synthetic" } }));
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
  return { rpc, details, send };
}

describe("background dispatch", () => {
  it("sends no content, forbids redirects and binds the result to its durable attempt", async () => {
    const f = dispatcherFixture();
    expect(await dispatchStudioPush(f.rpc, f.details, f.send, project)).toEqual({ accepted: 1, refused: false });
    expect(f.rpc.mock.calls[1]?.[0]).toBe("app_claim_studio_push_deliveries");
    expect(f.details.mock.calls[0]?.[1]).toBeNull();
    expect(f.send).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", body: null, redirect: "error" }));
    expect(f.rpc).toHaveBeenLastCalledWith("app_finish_studio_push_delivery", {
      p_delivery_id: "delivery", p_attempt_id: "attempt", p_outcome: "accepted", p_http_status: 201,
    });
  });
  it("does not fetch a forged endpoint even if the database returns one", async () => {
    const f = dispatcherFixture("https://127.0.0.1/secret");
    await dispatchStudioPush(f.rpc, f.details, f.send, project);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenLastCalledWith("app_finish_studio_push_delivery", expect.objectContaining({ p_outcome: "rejected" }));
  });
  it("records uncertain transport without a second send", async () => {
    const f = dispatcherFixture(); f.send.mockRejectedValue(new TypeError("connection interrupted"));
    await dispatchStudioPush(f.rpc, f.details, f.send, project);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenLastCalledWith("app_finish_studio_push_delivery", expect.objectContaining({ p_outcome: "unknown", p_http_status: null }));
  });
  it.each([[410,"rejected"],[429,"rejected"],[503,"unknown"]])("records provider status %s", async (status, outcome) => {
    const f = dispatcherFixture();f.send.mockResolvedValue(new Response(null,{status:Number(status)}));
    await dispatchStudioPush(f.rpc,f.details,f.send,project);
    expect(f.rpc).toHaveBeenLastCalledWith("app_finish_studio_push_delivery",expect.objectContaining({p_outcome:outcome,p_http_status:status}));
  });
  it("refuses production before accessing configuration or the network", async () => {
    const f = dispatcherFixture();
    expect((await dispatchStudioPush(f.rpc,f.details,f.send,"https://jwynqsyirgenqlmkooah.supabase.co")).refused).toBe(true);
    expect(f.rpc).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  });
});

function workerFixture(active = true, hasWindow = true) {
  const listeners: Record<string, (event: { waitUntil: (promise: Promise<void>) => void; notification?: {close:()=>void} }) => void> = {};
  const show = vi.fn();const send = vi.fn().mockResolvedValue({ok:true,json:async()=>({active})});
  const navigate=vi.fn();const focus=vi.fn();const open=vi.fn();
  const worker = {
    location:{origin:"https://studio.invalid"},
    addEventListener:(name:string, handler:typeof listeners[string])=>{listeners[name]=handler;},
    registration:{pushManager:{getSubscription:async()=>({endpoint})},showNotification:show},
    clients:{matchAll:async()=>hasWindow?[{url:"https://studio.invalid/account",navigate,focus}]:[],openWindow:open},
  };
  const source=readFileSync(new URL("../../public/push-sw.js",import.meta.url),"utf8");
  runInNewContext(source,{self:worker,fetch:send,URL,AbortSignal});
  async function fire(name:string){let work:Promise<void>|undefined;listeners[name]?.({waitUntil:p=>{work=p;},notification:{close:vi.fn()}});await work;}
  return {source,send,show,navigate,focus,open,fire};
}

describe("push-only worker",()=>{
  it("checks current login before showing fixed generic content",async()=>{
    const f=workerFixture();await f.fire("push");
    expect(f.send).toHaveBeenCalledWith("/api/push/status",expect.objectContaining({credentials:"include",cache:"no-store",redirect:"error"}));
    expect(f.show).toHaveBeenCalledWith("Wolf Forge",expect.objectContaining({tag:"wolf-forge-update",body:"You have a new update. Open your workspace to view it."}));
    expect(f.source).not.toMatch(/addEventListener\(["']fetch/);
    expect(f.source).not.toMatch(/caches\.|indexedDB|localStorage/);
  });
  it("shows nothing after logout, revocation or account mismatch",async()=>{
    const f=workerFixture(false);await f.fire("push");expect(f.show).not.toHaveBeenCalled();
  });
  it("fails closed when session verification is unavailable",async()=>{
    const f=workerFixture();f.send.mockRejectedValue(new TypeError("offline"));await f.fire("push");expect(f.show).not.toHaveBeenCalled();
  });
  it("notification click focuses an open workspace without discarding unsent work",async()=>{
    const f=workerFixture();await f.fire("notificationclick");
    expect(f.navigate).not.toHaveBeenCalled();expect(f.focus).toHaveBeenCalledOnce();expect(f.open).not.toHaveBeenCalled();
  });
  it("notification click opens same-origin role-aware launch when the workspace is closed",async()=>{
    const f=workerFixture(true,false);await f.fire("notificationclick");
    expect(f.open).toHaveBeenCalledWith("https://studio.invalid/launch");
  });
});

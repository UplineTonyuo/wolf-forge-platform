import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAction } from "../app/actions/auth";
import { clearSignedOutClientSupport } from "../lib/supabase/client-support-recovery";
import { CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE } from "../domain/auth/client-support";
import { IdentityLookupError } from "../lib/supabase/identity-lookup";

const state = vi.hoisted(() => ({ cookies: [] as {name:string;value:string}[], set:vi.fn(), verified:vi.fn(), protection:vi.fn(), signInClient:vi.fn() }));
vi.mock("next/headers", () => ({ cookies:async()=>({getAll:()=>state.cookies,set:state.set}) }));
vi.mock("next/navigation", () => ({ redirect:vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({
  getVerifiedSessionContext:state.verified, requestTenantSelector:async()=>"synthetic-tenant",
  createNextServerSignInSupabaseClient:state.signInClient, createNextServerSupabaseClient:vi.fn(),
  readLocalFrontendEnvironment:vi.fn(), resolveClientUser:vi.fn(), resolveInternalUser:vi.fn(), getInternalContext:vi.fn(),
}));
vi.mock("../lib/security/login-protection", () => ({
  beginProtectedLogin:state.protection, clearProtectedLoginPairFailures:vi.fn(), recordProtectedLoginFailure:vi.fn(),
}));
vi.mock("../lib/security/request-correlation", () => ({currentCorrelationId:async()=>null}));
vi.mock("../lib/security/security-log", () => ({recordSecurityEvent:vi.fn()}));
vi.mock("../lib/security/security-audit-log", () => ({recordSecurityAuditEvent:vi.fn()}));
beforeEach(()=>{
  vi.resetAllMocks();state.cookies=[];
  state.verified.mockResolvedValue(null);
  state.protection.mockResolvedValue({ok:false,reason:"bot"});
});
function form(){const data=new FormData();data.set("email","support-recovery@example.invalid");data.set("password","synthetic-password");return data;}
describe("signed-out client support recovery",()=>{
  it.each([CLIENT_SUPPORT_COOKIE,CLIENT_SUPPORT_EXIT_COOKIE])("clears stale %s before the normal protected login pipeline",async(name)=>{
    state.cookies=[{name,value:"expired-marker"}];
    const result=await signInAction({error:null},form());
    expect(result.error).not.toContain("Exit client support");
    expect(state.verified).toHaveBeenCalledWith(false);
    expect(state.set.mock.calls.map(([cookie])=>cookie)).toEqual([CLIENT_SUPPORT_COOKIE,CLIENT_SUPPORT_EXIT_COOKIE]);
    for(const [,value,options]of state.set.mock.calls){expect(value).toBe("");expect(options).toMatchObject({path:"/",maxAge:0,httpOnly:true,sameSite:"strict"});}
    expect(state.protection).toHaveBeenCalledWith("support-recovery@example.invalid");
    expect(state.signInClient).not.toHaveBeenCalled();
  });
  it.each([CLIENT_SUPPORT_COOKIE,CLIENT_SUPPORT_EXIT_COOKIE])("still refuses account replacement with %s and a verified original session",async(name)=>{
    state.cookies=[{name,value:"retained-marker"}];state.verified.mockResolvedValue({actor:{}});
    expect((await signInAction({error:null},form())).error).toContain("Exit client support");
    expect(state.set).not.toHaveBeenCalled();expect(state.protection).not.toHaveBeenCalled();expect(state.signInClient).not.toHaveBeenCalled();
  });
  it("does not mistake an identity outage for a signed-out browser",async()=>{
    state.cookies=[{name:CLIENT_SUPPORT_EXIT_COOKIE,value:"pending"}];
    state.verified.mockRejectedValue(new IdentityLookupError("unavailable","session"));
    expect((await signInAction({error:null},form())).error).toContain("Exit client support");
    expect(state.set).not.toHaveBeenCalled();expect(state.protection).not.toHaveBeenCalled();
  });
  it("does not clear markers after an unexpected verifier failure",async()=>{
    state.verified.mockRejectedValue(new Error("synthetic verifier failure"));
    expect(await clearSignedOutClientSupport()).toBe(false);expect(state.set).not.toHaveBeenCalled();
  });
  it("fails closed if expired-cookie persistence fails",async()=>{
    state.cookies=[{name:CLIENT_SUPPORT_COOKIE,value:"expired-marker"}];
    state.set.mockImplementation(()=>{throw new Error("synthetic cookie write failure");});
    await expect(signInAction({error:null},form())).rejects.toThrow("cookie write failure");
    expect(state.protection).not.toHaveBeenCalled();expect(state.signInClient).not.toHaveBeenCalled();
  });
});

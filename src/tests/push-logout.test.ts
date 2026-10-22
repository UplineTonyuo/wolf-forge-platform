import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { signOutAction } from "../app/actions/auth";
import { createNextServerSupabaseClient } from "../lib/supabase/next-server";

vi.mock("../lib/supabase/next-server",()=>({createNextServerSupabaseClient:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`);}}));
vi.mock("../lib/security/request-correlation",()=>({currentCorrelationId:async()=>"synthetic"}));
vi.mock("../lib/security/security-log",()=>({recordSecurityEvent:vi.fn()}));

const signOut=vi.fn().mockResolvedValue({error:null});
const rpc=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV","preview");vi.stubEnv("SUPABASE_URL","https://rsnmlcyopnxucwgfttyf.supabase.co");
  vi.mocked(createNextServerSupabaseClient).mockResolvedValue({rpc,auth:{signOut,getClaims:async()=>({data:{claims:{sub:"synthetic-client"}}})}} as unknown as Awaited<ReturnType<typeof createNextServerSupabaseClient>>);
});
afterEach(()=>vi.unstubAllEnvs());
it("signs out even when push cleanup throws synchronously",async()=>{
  rpc.mockImplementation(()=>{throw new Error("backend unavailable");});
  await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
  expect(signOut).toHaveBeenCalledOnce();
});
it.each([
  ["preview","https://rsnmlcyopnxucwgfttyf.supabase.co"],
  ["production","https://jwynqsyirgenqlmkooah.supabase.co"],
])("awaits SDK-style cleanup before logout in %s",async(environment,project)=>{
  vi.stubEnv("VERCEL_ENV",environment);vi.stubEnv("SUPABASE_URL",project);
  rpc.mockReturnValue({then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)});
  await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
  expect(rpc).toHaveBeenCalledWith("app_disable_my_push_session");expect(signOut).toHaveBeenCalledOnce();
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!);
});
it("does not invoke push RPCs with a mismatched production backend",async()=>{
  vi.stubEnv("VERCEL_ENV","production");
  await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
  expect(rpc).not.toHaveBeenCalled();expect(signOut).toHaveBeenCalledOnce();
});

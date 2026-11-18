import { describe, expect, it, vi } from "vitest";
import { applyBackend, main } from "../../scripts/migration/spp-accounts-import";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { guardTarget, parseCsv, runImport, type ImportBackend } from "../../scripts/migration/spp-accounts-core";

const row = (id = "101", email = "ada@example.com") => ({ id, email, name_f: "Ada", name_l: "Example", company: "Example Studio", phone: "", stripe_customer_id: "cus_test101" });
function backend() {
  const records = new Map<string, { state: string; tenant_id: string; hash?: string }>();
  const emails = new Set<string>();
  const api: ImportBackend = {
    inspect: vi.fn(async () => ({ tenant_id: "f0f0f0f0-0000-4000-8000-000000000001", state: "ready" })),
    claim: vi.fn(async (id, hash) => {
      const previous = records.get(id);
      if (previous) return previous.hash !== hash ? {tenant_id:previous.tenant_id,state:"conflict"} : previous;
      if (emails.has(hash)) return { tenant_id: "f0f0f0f0-0000-4000-8000-000000000001", state: "complete" };
      emails.add(hash); records.set(id, { tenant_id: "f0f0f0f0-0000-4000-8000-000000000001", state: "pending", hash });
      return { tenant_id: "f0f0f0f0-0000-4000-8000-000000000001", state: "claimed", auth_claim_id: authClaim };
    }),
    createUser: vi.fn(async () => "user-synthetic"),
    complete: vi.fn(async (id) => { records.set(id, { ...records.get(id)!, state: "complete" }); return { tenant_id: "f0f0f0f0-0000-4000-8000-000000000001", state: "complete" }; }),
    verify: vi.fn(async (id: string) => records.get(id)!),
    wolfTenant: "f0f0f0f0-0000-4000-8000-000000000001",
  };
  return api;
}
const authClaim = randomUUID();
const production = {
  apply: true, productionPilot: true, projectRef: "jwynqsyirgenqlmkooah",
  url: "https://jwynqsyirgenqlmkooah.supabase.co", onlyEmails: new Set(["ada@example.com"]),
};
const apply = { apply: true, projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co" };

describe("SPP Accounts importer", () => {
  it("defaults to an offline dry run and never reaches a mutation", async () => {
    const api=backend(); const result=await runImport([row()], {}, api);
    expect(result.would_create).toBe(1); expect(result.created).toBe(0);
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.claim).not.toHaveBeenCalled();
    expect(api.createUser).not.toHaveBeenCalled(); expect(api.complete).not.toHaveBeenCalled();
  });
  it.each([
    ["jwynqsyirgenqlmkooah", "https://jwynqsyirgenqlmkooah.supabase.co"],
    ["abcdefghijklmnopqrst", "https://jwynqsyirgenqlmkooah.supabase.co"],
    [undefined, apply.url], [apply.projectRef, undefined],
    [apply.projectRef, "https://differentprojectrefa.supabase.co"],
    [apply.projectRef, "http://abcdefghijklmnopqrst.supabase.co"],
    [apply.projectRef, "https://abcdefghijklmnopqrst.supabase.co.evil.example"],
    [apply.projectRef, "https://abcdefghijklmnopqrst.supabase.co/path"],
  ])("refuses unsafe or indeterminate apply targets", async (projectRef,url) => {
    const api=backend(); await expect(runImport([row()],{apply:true,projectRef,url},api)).rejects.toThrow();
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.createUser).not.toHaveBeenCalled();
  });
  it("accepts only an exact nonproduction project match", () => expect(guardTarget(apply)).toBe(apply.projectRef));
  it("allows the explicit production pilot with one reviewed identity", async () => {
    const api = backend();
    vi.mocked(api.claim).mockResolvedValue({ tenant_id: api.wolfTenant, state: "claimed", auth_claim_id: authClaim });
    vi.mocked(api.verify).mockResolvedValue({ tenant_id: api.wolfTenant, state: "complete" });
    const result = await runImport([row(), row("102", "other@example.com")], production, api);
    expect(result.created).toBe(1);
    expect(api.createUser).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ email: "ada@example.com" }), authClaim);
  });
  it("refuses conflicting source rows before production database or Auth calls", async () => {
    const api = backend();
    const result = await runImport([row(), row("102")], production, api);
    expect(result.created).toBe(0);
    expect(result.reasons.production_pilot_scope).toBe(1);
    expect(api.inspect).not.toHaveBeenCalled();
    expect(api.claim).not.toHaveBeenCalled();
  });
  it.each([undefined, new Set<string>(), new Set(["ada@example.com", "other@example.com"])])(
    "refuses a production pilot without exactly one selected email", (onlyEmails) => {
      expect(() => guardTarget({ ...production, onlyEmails })).toThrow("Import target refused");
    },
  );
  it("confines the explicit production flag to the production endpoint", () => {
    expect(() => guardTarget({ ...production, url: apply.url, projectRef: apply.projectRef })).toThrow("Import target refused");
  });
  it("does not call production Auth without a valid claim receipt", async () => {
    const api = backend();
    vi.mocked(api.claim).mockResolvedValue({ tenant_id: api.wolfTenant, state: "claimed" });
    const result = await runImport([row()], production, api);
    expect(result.reasons.manual_review).toBe(1);
    expect(api.createUser).not.toHaveBeenCalled();
  });
  it("creates without a password and uses only explicit provisioning capabilities", async () => {
    const api=backend(); const forbidden=vi.fn(() => { throw new Error("notification reached"); });
    const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(forbidden);
    try {
      const result=await runImport([row()],apply,api);
      expect(result.created).toBe(1); expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ email:"ada@example.com" }), authClaim);
      expect(Object.hasOwn(vi.mocked(api.createUser).mock.calls[0]![0],"password")).toBe(false);
      expect(forbidden).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("imports once across two runs", async () => {
    const api=backend(); await runImport([row()],apply,api); const second=await runImport([row()],apply,api);
    expect(second.would_skip_already_imported).toBe(1); expect(api.createUser).toHaveBeenCalledTimes(1);
  });
  it("deduplicates case-insensitive emails and repeated IDs", async () => {
    const api=backend(); const result=await runImport([row(),row("102","ADA@example.com"),row()],apply,api);
    expect(result.duplicate_emails).toBe(1); expect(result.duplicate_ids).toBe(1); expect(result.created).toBe(1);
    expect(api.createUser).toHaveBeenCalledTimes(1);
  });
  it("honors the pilot subset and normalizes its emails", async () => {
    const result=await runImport([row(),row("102","ben@example.com")],{onlyEmails:new Set(["ADA@example.com"])});
    expect(result.would_create).toBe(1); expect(result.filtered_out).toBe(1);
  });
  it("uses the approved personal-name company fallback and rejects missing identity", async () => {
    const api=backend(); const result=await runImport([{...row(),company:""},{...row("102","ben@example.com"), company:"", name_f:"",name_l:""}],apply,api);
    expect(result.created).toBe(1); expect(result.reasons.missing_company).toBe(1);
    expect(api.complete).toHaveBeenCalledWith("101",expect.any(String),expect.objectContaining({company_name:"Ada Example"}));
  });
  it("fails closed for another tenant before claiming or creating", async () => {
    const api=backend(); vi.mocked(api.inspect).mockResolvedValue({tenant_id:"other",state:"ready"});
    await expect(runImport([row()],apply,api)).rejects.toThrow(); expect(api.claim).not.toHaveBeenCalled();
  });
  it("stops for a pending or uncertain earlier attempt without retrying Auth", async () => {
    const api=backend(); vi.mocked(api.createUser).mockRejectedValue(new Error("private arbitrary remote text"));
    const first=await runImport([row()],apply,api); const second=await runImport([row()],apply,api);
    expect(first.reasons.manual_review).toBe(1); expect(second.reasons.manual_review).toBe(1);
    expect(api.createUser).toHaveBeenCalledTimes(1); expect(JSON.stringify(first)).not.toContain("private arbitrary");
  });
  it("rejects invalid email, oversized fields and credential-like content without retaining values", async () => {
    const result=await runImport([row("101","bad"),{...row("102"),phone:"1".repeat(51)},{...row("103"),company:"password=synthetic-secret"}],{});
    expect(result.rejected).toBe(3); expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
  it("ignores unmapped free text and finance values", async () => {
    const api=backend(); await runImport([{...row(),note:"password=synthetic-secret",balance:"100",Spent:"200",status:"staff"}],apply,api);
    expect(api.complete).toHaveBeenCalledWith("101",expect.any(String),expect.not.objectContaining({note:expect.anything()}));
  });
  it("parses BOM, escaped quotes, multiline values and CRLF across chunks", async () => {
    const rows=[]; for await (const item of parseCsv(Readable.from(['\ufeffid,email,company\r\n101,ada@example.com,"Example',' ""Studio""\nWorks"\r','\n']))) rows.push(item);
    expect(rows).toEqual([{id:"101",email:"ada@example.com",company:'Example "Studio"\nWorks'}]);
  });
  it.each(['id,email\n101,"broken','id,id\n101,102','id,email\n101,ada@example.com,extra'])('rejects malformed CSV without quoting its input',async (csv) => {
    await expect(async () => { for await (const item of parseCsv(Readable.from([csv]))) void item; }).rejects.toThrow("CSV");
  });
});
describe("SPP apply transport", () => {
  it("reaches only the source-reference RPC and claim-bound admin creation; all notification paths throw", async () => {
    const calls: string[]=[];
    const transport=vi.spyOn(globalThis,"fetch").mockImplementation(async (input,init) => {
      const url=String(input); calls.push(url);
      const body=JSON.parse(String(init?.body ?? "{}"));
      if (url===`${production.url}/rest/v1/rpc/app_spp_account_import`) {
        expect(new Headers(init?.headers).get("x-wf-tenant")).toBe("f0f0f0f0-0000-4000-8000-000000000001");
        const states: Record<string,string>={inspect:"ready",claim:"claimed",complete:"complete",verify:"complete"};
        if (!states[body.p_operation]) throw new Error("unapproved RPC operation");
        return new Response(JSON.stringify({tenant_id:"f0f0f0f0-0000-4000-8000-000000000001",state:states[body.p_operation],...(body.p_operation === "claim" ? { auth_claim_id: authClaim } : {})}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if (url===`${production.url}/auth/v1/admin/users`) {
        expect(body).toEqual({email:"ada@example.com",email_confirm:true,user_metadata:{display_name:"Ada Example"},app_metadata:{spp_import_claim_id:authClaim}});
        return new Response(JSON.stringify({id:"20000000-0000-4000-8000-000000002132",email:"ada@example.com"}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      throw new Error("email, invite, activation, push, webhook, Gmail, Stripe or unknown path reached");
    });
    try {
      const api=applyBackend(production,{NODE_ENV:"test",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SECRET_KEY:"synthetic-secret",SPP_IMPORT_OPERATOR_TOKEN:"synthetic-operator"});
      const result=await runImport([row()],production,api);
      expect(result.created).toBe(1); expect(result.rejected).toBe(0); expect(calls).toHaveLength(5);
    } finally { transport.mockRestore(); }
  });
});
describe("SPP preflight integrity", () => {
  it("rejects every occurrence of a source ID with conflicting emails before provisioning", async () => {
    const api=backend(); const result=await runImport([row(),row("101","ben@example.com")],apply,api);
    expect(result.created).toBe(0); expect(result.reasons.conflicting_source_id).toBe(2);
    expect(api.createUser).not.toHaveBeenCalled();
  });
  it("validates the entire CSV before any apply side effect", async () => {
    const api=backend();
    const rows=parseCsv(Readable.from(['id,email,name_f,name_l,company\n101,ada@example.com,Ada,Example,Studio\n102,"unterminated']));
    await expect(runImport(rows,apply,api)).rejects.toThrow("CSV");
    expect(api.claim).not.toHaveBeenCalled(); expect(api.createUser).not.toHaveBeenCalled();
  });
  it("refuses a wrong header even when the CSV contains no data rows", async () => {
    await expect(async()=>{for await (const row of parseCsv(Readable.from(['wrong,header\n']),['id','email'])) void row;}).rejects.toThrow("CSV");
  });
});
it("rejects an excluded form_data filename without opening it", async()=> {
  await expect(main(['--csv','rankfortress-form_data-synthetic.csv'])).rejects.toThrow('Excluded');
});
it("rejects credential-bearing form-data columns before yielding any row", async()=> {
  await expect(async()=>{for await (const row of parseCsv(Readable.from(['id,email,field_value\n101,ada@example.com,synthetic']))) void row;}).rejects.toThrow('CSV');
});
it("checks distinct source IDs even when their emails repeat in a later run",async()=> {
  const api=backend(); await runImport([row("102","ben@example.com")],apply,api);
  const result=await runImport([row("101"),row("102")],apply,api);
  expect(result.reasons.manual_review).toBe(1);
});
it("counts success only after a fresh read confirms persisted state",async()=> {
  const api=backend(); vi.mocked(api.verify).mockResolvedValue({tenant_id:"f0f0f0f0-0000-4000-8000-000000000001",state:"pending"});
  const result=await runImport([row()],apply,api);
  expect(api.verify).toHaveBeenCalledWith("101"); expect(result.created).toBe(0); expect(result.reasons.manual_review).toBe(1);
});
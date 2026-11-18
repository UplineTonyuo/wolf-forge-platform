import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { guardTarget, parseCsv, runImport, WOLF_TENANT, type ImportBackend, type ImportFields, type Options, type Receipt } from "./spp-accounts-core";

export function applyBackend(options: Options, env: NodeJS.ProcessEnv = process.env): ImportBackend {
  guardTarget(options);
  if (!env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY || !env.SPP_IMPORT_OPERATOR_TOKEN) throw new Error("Import credentials unavailable.");
  const init = { auth: { persistSession:false,autoRefreshToken:false,detectSessionInUrl:false } };
  // Only the supplied owner's verified session can reach the guarded database RPC.
  const session = createClient(options.url!,env.SUPABASE_PUBLISHABLE_KEY,{...init,global:{headers:{Authorization:`Bearer ${env.SPP_IMPORT_OPERATOR_TOKEN}`,"x-wf-tenant":WOLF_TENANT}}});
  const admin = createClient(options.url!,env.SUPABASE_SECRET_KEY,init);
  const rpc = async (args: Record<string,unknown>): Promise<Receipt> => {
    const {data,error}=await session.rpc("app_spp_account_import",args);
    if (error || !data || typeof data !== "object" || typeof data.tenant_id !== "string" || typeof data.state !== "string" ||
      (data.auth_claim_id !== undefined && typeof data.auth_claim_id !== "string")) throw new Error("Import database request failed.");
    return data as Receipt;
  };
  return {
    wolfTenant:WOLF_TENANT,
    inspect:()=>rpc({p_operation:"inspect"}),
    claim:(id,hash)=>rpc({p_operation:"claim",p_spp_id:id,p_email_hash:hash}),
    createUser:async (fields: ImportFields, authClaimId: string) => {
      const {data,error}=await admin.auth.admin.createUser({
        email: fields.email,
        email_confirm: true,
        user_metadata: { display_name: fields.display_name },
        app_metadata: { spp_import_claim_id: authClaimId },
      });
      if (error || !data.user) throw new Error("Import Auth request failed.");
      return data.user.id;
    },
    verify:(id)=>rpc({p_operation:"verify",p_spp_id:id}),
    complete:(id,userId,fields)=>rpc({p_operation:"complete",p_spp_id:id,p_auth_id:userId,p_fields:fields}),
  };
}
export async function main(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const options: Options={}; let csvPath: string | undefined; let pilotPath: string | undefined;
  const seen=new Set<string>();
  for (let i=0;i<args.length;i++) {
    const arg=args[i]!;
    if (seen.has(arg)) throw new Error("Import arguments refused."); seen.add(arg);
    if (arg==="--apply") options.apply=true;
    else if (arg==="--production-pilot") options.productionPilot=true;
    else if (["--csv","--only-emails","--target-project-ref"].includes(arg)) {
      const value=args[++i]; if (!value || value.startsWith("--")) throw new Error("Import arguments refused.");
      if (arg==="--csv") csvPath=value; else if (arg==="--only-emails") pilotPath=value; else options.projectRef=value;
    } else throw new Error("Import arguments refused.");
  }
  if (!csvPath) throw new Error("Import CSV argument required.");
  if (/form_data/i.test(basename(csvPath))) throw new Error("Excluded CSV path.");
  if (options.apply) {
    options.url=env.SUPABASE_URL;
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL !== options.url) throw new Error("Import target configuration conflicts.");
  }
  if (options.productionPilot && !options.apply) throw new Error("Import arguments refused.");
  if (pilotPath) {
    const content=await readFile(pilotPath,"utf8");
    const emails=content.replace(/^\ufeff/,"").split(/\r?\n/).map(v=>v.trim().toLowerCase()).filter(Boolean);
    if (!emails.length || emails.some(v=>!/^\S+@\S+\.\S+$/.test(v))) throw new Error("Import pilot file refused.");
    options.onlyEmails=new Set(emails);
  }
  if (options.apply) guardTarget(options);
  const rows=parseCsv(createReadStream(csvPath,{encoding:"utf8"}),["id","email","name_f","name_l","company"]);
  async function* accounts() {
    for await (const row of rows) {
      if (!["id","email","name_f","name_l","company"].every(key=>Object.hasOwn(row,key))) throw new Error("CSV Accounts columns missing.");
      yield row;
    }
  }
  return runImport(accounts(),options,options.apply ? applyBackend(options,env) : undefined);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const counts=await main(process.argv.slice(2)); process.stdout.write(JSON.stringify(counts)+"\n"); if (counts.reasons.manual_review || counts.reasons.production_pilot_scope) process.exitCode=1; }
  catch { process.stdout.write('{"rejected":1,"reasons":{"fatal_input_or_target":1}}\n'); process.exitCode=1; }
}
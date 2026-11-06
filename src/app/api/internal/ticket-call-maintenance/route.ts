import { timingSafeEqual } from "node:crypto";
import { dailyRequest } from "../../../../lib/daily/calls";
import { createDailyCallProvider } from "../../../../lib/daily/provider";
import { reconcileDailyCalls } from "../../../../lib/daily/reconciliation";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";
import { reconcileTicketCallCleanup,reconcileManualCallPresence } from "../../../../services/ticket-call-provider";
import type { CallRpc } from "../../../../services/ticket-call-service";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret || secret.length<32)return reply({ok:false},503);
 const a=Buffer.from(secret),b=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"");
 if(a.length!==b.length || !timingSafeEqual(a,b))return reply({ok:false},401);
 // Cleanup is still allowed with admission OFF. A missing key cannot certify cleanup.
 const key=process.env.DAILY_API_KEY;
 if(process.env.DAILY_DOMAIN!=="wolfforge.daily.co" || !key || key.length>1024 || /\s/.test(key))return reply({ok:false},503);
 try{
  const trusted=createTrustedServerSupabaseClient(readServerEnvironment()) as unknown as CallRpc;
  const provider=createDailyCallProvider(key,3000);
  const presence=await reconcileManualCallPresence(trusted,provider);
  const cleanup=await reconcileTicketCallCleanup(trusted,provider);
  const usage=process.env.DAILY_CALLS_ENABLED==="1"?await reconcileDailyCalls(trusted,endpoint=>dailyRequest(key,endpoint,"GET",undefined,5000)):{pages:0,complete:false};
  return reply({ok:true,...presence,...cleanup,...usage});
 }catch{return reply({ok:false,error:"Call maintenance could not be confirmed."},503);}
}

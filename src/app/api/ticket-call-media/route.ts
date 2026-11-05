import { z } from "zod";
import { ApplicationError } from "../../../lib/errors/application-error";
import { readDailyCallConfig } from "../../../lib/daily/calls";
import { createDailyCallProvider } from "../../../lib/daily/provider";
import { readServerEnvironment } from "../../../lib/env/server-env";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getVerifiedSessionContext } from "../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../lib/supabase/trusted-server-client";
import { prepareTicketCallMedia, confirmTicketCallPresence } from "../../../services/ticket-call-provider";
import type { CallRpc } from "../../../services/ticket-call-service";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const input=z.object({call_id:z.uuid(),device_id:z.uuid(),action:z.enum(["join","presence"]).default("join")}).strict();
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
export async function POST(request:Request){
  if(!requestIsSameOrigin(request))return reply({ok:false},403);
  const body=await readBoundedJson(request,1024);
  if(!body.ok)return reply({ok:false},body.status);
  const parsed=input.safeParse(body.value);
  if(!parsed.success)return reply({ok:false},400);
  try{
    const config=readDailyCallConfig();
    if(!config)return reply({ok:false,error:"Calling is unavailable."},503);
    const context=await getVerifiedSessionContext();
    if(!context)return reply({ok:false},401);
    if(context.actor.support)return reply({ok:false},403);
    const trusted=createTrustedServerSupabaseClient(readServerEnvironment()) as unknown as CallRpc;
    const operation=parsed.data.action==="presence"?confirmTicketCallPresence:prepareTicketCallMedia;
    const data=await operation(context.client,trusted,createDailyCallProvider(config.key),parsed.data.call_id,parsed.data.device_id);
    return reply({ok:true,data});
  }catch(error){
    if(error instanceof ApplicationError && error.code==="RATE_LIMITED")return Response.json(
      {ok:false,error:"Too many call attempts. Please wait and try again."},
      {status:429,headers:{"cache-control":"private, no-store","Retry-After":"60"}});
    return reply({ok:false,error:"Could not connect this call. Check your access or try again."},503);
  }
}

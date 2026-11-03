import "server-only";
import { z } from "zod";
import { callRpc, type CallRpc } from "../../services/ticket-call-service";
const participant=z.object({user_id:z.string().nullable(),participant_id:z.string().min(1).max(90),join_time:z.number().finite().nonnegative(),duration:z.number().finite().nonnegative()});
const meeting=z.object({id:z.uuid(),room:z.string().min(1).max(128),start_time:z.number().finite().nonnegative(),duration:z.number().finite().nonnegative(),max_participants:z.number().int().min(0).max(100000),ongoing:z.boolean(),participants:z.array(participant).max(128)});
const page=z.object({total_count:z.number().int().nonnegative(),data:z.array(meeting).max(10)});
const scan=z.object({id:z.uuid(),month:z.string().regex(/^\d{4}-\d{2}-01$/),cutoff:z.number().int().positive(),cursor:z.uuid().nullable()});
// One durable page per invocation. Uncertain pages never refresh allowance or release holds.
export async function reconcileDailyCalls(trusted:CallRpc,read:(endpoint:string)=>Promise<unknown>){
 const value=await callRpc(trusted,"app_claim_ticket_call_provider_scan",{});
 if(value===null)return {pages:0,complete:false};
 const lease=scan.parse(value);
 const params=new URLSearchParams({limit:"10",timeframe_end:String(lease.cutoff)});
 if(lease.cursor)params.set("starting_after",lease.cursor);
 const result=page.parse(await read(`meetings?${params}`));
 const ids=result.data.map(m=>m.id);
 if(new Set(ids).size!==ids.length || ids.includes(lease.cursor??""))throw new Error("Provider pagination repeated");
 const complete=result.data.length<10;
 if(await callRpc(trusted,"app_apply_ticket_call_provider_page",{
  p_scan_id:lease.id,p_after:lease.cursor,p_meetings:result.data,p_complete:complete,
 })!==true)throw new Error("Provider reconciliation not persisted");
 return {pages:1,complete};
}

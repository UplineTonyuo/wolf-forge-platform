import { notFound,redirect } from "next/navigation";
import { callAvailability } from "../../../domain/tickets/calls";
import { callConversationPath,callEntryPath } from "../../../domain/tickets/call-entry";
import { getVerifiedSessionContext } from "../../../lib/supabase/next-server";
import { readTicketCalls } from "../../../services/ticket-call-service";
export const dynamic="force-dynamic";
export default async function CallEntry({params}:{params:Promise<{callId:string}>}){
 const {callId}=await params;const path=callEntryPath(callId);if(!path)notFound();
 const context=await getVerifiedSessionContext();if(!context)redirect(`/login?next=${encodeURIComponent(path)}`);
 if(context.actor.support)return <p>Return to your administrator account before opening a call.</p>;
 const value=await readTicketCalls(context.client,{action:"current",call_id:callId}).catch(()=>null);
 const result=callAvailability.safeParse(value);
 if(!result.success||!result.data.call||!result.data.ticketId)return <p>This call is no longer available. Open your Inbox to continue.</p>;
 redirect(callConversationPath(result.data.accountClass,result.data.ticketId,callId));
}

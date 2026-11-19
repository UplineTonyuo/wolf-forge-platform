import { z } from "zod";
import { submitClientRating } from "../../app/actions/process";
import { getClientContext } from "../../lib/supabase/next-server";
import { OrderRevisionForm } from "./order-revision-form";

export async function readClientFeedback(section:"orders"|"tickets", target:string) {
  const {actor,client}=await getClientContext();
  if(actor.support) return null;
  const result=await client.rpc("app_client_process",{p_section:section,p_target:target});
  if(result.error) throw new Error("Could not load the available feedback options.");
  return z.object({
    lock:z.boolean(), reopen:z.boolean(), ratings:z.boolean(), score:z.number().nullable(),
    completed_at:z.iso.datetime({offset:true}).nullable(),
  }).parse(result.data);
}
export function ClientFeedback({section,target,state}:{section:"orders"|"tickets";target:string;state:Awaited<ReturnType<typeof readClientFeedback>>}) {
  if(!state) return null;
  const action=submitClientRating.bind(null,section,target);
  return <>
    {section==="orders" && state.reopen && state.completed_at &&
      <OrderRevisionForm key={target+state.completed_at} orderId={target} completedAt={state.completed_at}/>}
    {state.ratings && <form action={action} className="portal-section"><fieldset><legend>Rate this {section==="orders"?"order":"ticket"}</legend>
      {[1,2,3,4,5].map(n=><label key={n}><input type="radio" required name="score" value={n} defaultChecked={state.score===n}/>{n}</label>)}</fieldset>
      <button type="submit">Save rating</button></form>}
  </>;
}


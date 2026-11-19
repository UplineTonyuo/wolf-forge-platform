import { z } from "zod";
import { getInternalContext } from "../../lib/supabase/next-server";
import { processEntrySchema } from "../../domain/process/settings";
import { ResourceTags } from "./resource-tags";

export async function ResourceProcess({kind,target,editable}:{kind:"projects"|"tickets"|"clients";target:string;editable:boolean}) {
  const {client}=await getInternalContext();
  const result=await client.rpc("app_resource_process",{p_kind:kind,p_target:target});
  if(result.error) return <p role="status">Workspace tags and feedback are unavailable.</p>;
  const {entries,assigned,average,count}=z.object({entries:processEntrySchema.array(),assigned:z.array(z.string()),average:z.number().nullable(),count:z.number()}).parse(result.data);
  return <>
    <ResourceTags kind={kind} target={target} entries={entries} assigned={assigned} editable={editable}/>
    {count>0 && <p>Client rating · {average} of 5 ({count})</p>}
  </>;
}


import { cache } from "react";
import { processEntrySchema, type ProcessSection, snapshotSchema } from "../../domain/process/settings";
import { getInternalContext } from "../supabase/next-server";
export const readProcess = cache(async (section: ProcessSection) => {
  const { client } = await getInternalContext();
  const { data,error } = await client.rpc("app_process_config",{p_section:section});
  if(error) throw new Error("Workspace settings could not be loaded.");
  return snapshotSchema.parse(data);
});

export const readWorkflowStages = cache(async (section: "orders" | "tickets" | "clients") => {
  const { client } = await getInternalContext();
  const { data, error } = await client.rpc("app_process_entries", { p_section: section });
  if (error) throw new Error("Workspace stages could not be loaded.");
  return processEntrySchema.array().parse(data);
});


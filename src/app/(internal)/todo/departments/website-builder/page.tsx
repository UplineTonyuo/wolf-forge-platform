import type { Metadata } from "next";
import { WebsiteBuilderWorkflowView } from "../../../../../components/operations/website-builder-workflow-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";
import { loadWebsiteBuilderWorkflow } from "../../../../../services/website-builder-workflow-service";

export const metadata: Metadata = { title: "Operations — Website Builder" };

export default async function WebsiteBuilderPage() {
  await getInternalContext();
  const result = await loadWebsiteBuilderWorkflow();
  if (result.state !== "ready") return <WebsiteBuilderWorkflowView state={result.state} projects={[]} sourceTab={null} lastSyncedAt={null} />;
  return <WebsiteBuilderWorkflowView state="ready" projects={result.snapshot.projects} sourceTab={result.snapshot.sourceTab} lastSyncedAt={result.snapshot.lastSyncedAt} />;
}

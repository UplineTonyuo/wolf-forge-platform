import type { Metadata } from "next";
import { TechnicalSeoWorkflowView } from "../../../../../components/operations/technical-seo-workflow-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";
import { loadTechnicalSeoWorkflow } from "../../../../../services/technical-seo-workflow-service";

export const metadata: Metadata = { title: "Operations — Technical SEO" };

export default async function TechnicalSeoPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await getInternalContext();
  const { month } = await searchParams;
  const result = await loadTechnicalSeoWorkflow(month ?? null);
  if (result.state !== "ready") return <TechnicalSeoWorkflowView state={result.state} items={[]} sourceTab={null} lastSyncedAt={null} />;
  return <TechnicalSeoWorkflowView state="ready" {...result.bundle} />;
}

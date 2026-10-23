import type { Metadata } from "next";
import { OnPageSeoWorkflowView } from "../../../../../components/operations/on-page-seo-workflow-view";
import { requireWolfForgeOperations } from "../../../../../lib/security/wolf-forge-operations";
import { loadOnPageSeoWorkflow } from "../../../../../services/on-page-seo-workflow-service";

export const metadata: Metadata = { title: "Operations — On-page SEO" };

export default async function OnPageSeoPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireWolfForgeOperations();
  const { month } = await searchParams;
  const result = await loadOnPageSeoWorkflow(month ?? null);
  if (result.state !== "ready") return <OnPageSeoWorkflowView state={result.state} items={[]} sourceTab={null} lastSyncedAt={null} />;
  return <OnPageSeoWorkflowView state="ready" items={result.bundle.snapshot.items} sourceTab={result.bundle.snapshot.sourceTab} lastSyncedAt={result.bundle.snapshot.lastSyncedAt} monthOptions={result.bundle.monthOptions} selectedMonth={result.bundle.selectedMonth} />;
}

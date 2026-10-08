import type { Metadata } from "next";
import { OffPageSeoWorkflowView } from "../../../../../components/operations/off-page-seo-workflow-view";
import { requireWolfForgeOperations } from "../../../../../lib/security/wolf-forge-operations";
import { loadOffPageSeoWorkflow } from "../../../../../services/off-page-seo-workflow-service";

export const metadata: Metadata = { title: "Operations — Off-page SEO" };

export default async function OffPageSeoPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireWolfForgeOperations();
  const { month } = await searchParams;
  const result = await loadOffPageSeoWorkflow(month ?? null);
  if (result.state !== "ready") return <OffPageSeoWorkflowView state={result.state} items={[]} sourceTab={null} lastSyncedAt={null} />;
  return <OffPageSeoWorkflowView state="ready" items={result.bundle.snapshot.items} sourceTab={result.bundle.snapshot.sourceTab} lastSyncedAt={result.bundle.snapshot.lastSyncedAt} monthOptions={result.bundle.monthOptions} selectedMonth={result.bundle.selectedMonth} />;
}

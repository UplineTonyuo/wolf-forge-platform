import type { Metadata } from "next";
import { GmbManagementWorkflowView } from "../../../../../components/operations/gmb-management-workflow-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";
import { loadGmbManagementWorkflow } from "../../../../../services/gmb-management-workflow-service";

export const metadata: Metadata = { title: "Operations — GMB Management" };

export default async function GmbManagementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await getInternalContext();
  const { month } = await searchParams;
  const result = await loadGmbManagementWorkflow(month ?? null);
  if (result.state !== "ready") return <GmbManagementWorkflowView state={result.state} items={[]} sourceTab={null} lastSyncedAt={null} />;
  return <GmbManagementWorkflowView state="ready" items={result.bundle.snapshot.items} sourceTab={result.bundle.snapshot.sourceTab} lastSyncedAt={result.bundle.snapshot.lastSyncedAt} monthOptions={result.bundle.monthOptions} selectedMonth={result.bundle.selectedMonth} />;
}

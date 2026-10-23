import type { Metadata } from "next";
import { YoutubeSeoWorkflowView } from "../../../../../components/operations/youtube-seo-workflow-view";
import { requireWolfForgeOperations } from "../../../../../lib/security/wolf-forge-operations";
import { loadYoutubeSeoWorkflow } from "../../../../../services/youtube-seo-workflow-service";

export const metadata: Metadata = { title: "Operations — YouTube SEO" };

export default async function YoutubeSeoPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireWolfForgeOperations();
  const { month } = await searchParams;
  const result = await loadYoutubeSeoWorkflow(month ?? null);
  if (result.state !== "ready") return <YoutubeSeoWorkflowView state={result.state} items={[]} sourceTab={null} lastSyncedAt={null} />;
  return <YoutubeSeoWorkflowView state="ready" items={result.bundle.snapshot.items} sourceTab={result.bundle.snapshot.sourceTab} lastSyncedAt={result.bundle.snapshot.lastSyncedAt} monthOptions={result.bundle.monthOptions} selectedMonth={result.bundle.selectedMonth} />;
}

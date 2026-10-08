import type { Metadata } from "next";
import { ContentWorkflowView } from "../../../../../components/operations/content-workflow-view";
import { requireWolfForgeOperations } from "../../../../../lib/security/wolf-forge-operations";
import { loadContentWorkflow } from "../../../../../services/content-workflow-service";

export const metadata: Metadata = { title: "Operations — Content" };

export default async function ContentPage() {
  await requireWolfForgeOperations();
  const result = await loadContentWorkflow();

  if (result.state !== "ready") {
    return (
      <ContentWorkflowView
        state={result.state}
        items={[]}
        sourceTab={null}
        lastSyncedAt={null}
      />
    );
  }

  return (
    <ContentWorkflowView
      state="ready"
      items={result.snapshot.items}
      sourceTab={result.snapshot.sourceTab}
      lastSyncedAt={result.snapshot.lastSyncedAt}
    />
  );
}

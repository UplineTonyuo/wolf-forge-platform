import type { Metadata } from "next";
import { ContentWorkflowView } from "../../../../../components/operations/content-workflow-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";
import { loadContentWorkflow } from "../../../../../services/content-workflow-service";

export const metadata: Metadata = { title: "Operations — Content" };

export default async function ContentPage() {
  await getInternalContext();
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

"use client";

import { useState } from "react";
import type { InternalReportDocument } from "../../domain/reporting/schema";
import { reportingProfileForService } from "../../domain/reporting/service-profiles";
import { ReportBuilder } from "./report-builder";
import { ReportWizard } from "./report-wizard";

/**
 * The report editor plus a stable boundary for its completion faces.
 *
 * The send action calls revalidatePath, which makes Next re-render this route
 * as soon as the action completes — the report is now SENT, so the page would
 * normally swap the wizard for the read-only builder and unmount the wizard,
 * killing the "Report delivered" outro mid-flight.
 *
 * This host snapshots the document it was given on first render, so the
 * editor it renders keeps the same props through that refresh and stays
 * mounted while the outro plays its full duration; the completion faces
 * themselves then navigate to /reporting by clicking a hidden Link
 * (report-flow-status.tsx). The snapshot is deliberately never updated —
 * the outro covers the viewport and the flow always ends on the Reporting
 * list, never on a stale editor.
 */
export function ReportCompletionHost({
  document,
  canSend,
  advanced,
}: {
  document: InternalReportDocument;
  canSend: boolean;
  advanced: boolean;
}) {
  const [heldDocument] = useState(document);

  const editor =
    heldDocument.status === "draft"
      && !advanced
      && reportingProfileForService(heldDocument.service_id) ? (
      <ReportWizard document={heldDocument} canSend={canSend} />
    ) : (
      <ReportBuilder document={heldDocument} canSend={canSend} />
    );

  return editor;
}

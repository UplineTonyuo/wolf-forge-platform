import "server-only";

import { parseTechnicalSeoWorkflowRows, type TechnicalSeoItem } from "../domain/operations/technical-seo-workflow";
import { createTechnicalSeoWorkflowSource, TechnicalSeoSourceNotConfiguredError, TechnicalSeoSourceUnavailableError, type TechnicalSeoWorkflowSource } from "../lib/integrations/technical-seo-workflow-source";
import { resolveOperationsWorkflowMonthSelection, type OperationsWorkflowMonthOption } from "../lib/integrations/operations-google-sheets";

export type TechnicalSeoWorkflowBundle = {
  items: TechnicalSeoItem[];
  sourceTab: string;
  lastSyncedAt: string;
  monthOptions: OperationsWorkflowMonthOption[];
  selectedMonth: string;
};
export type TechnicalSeoWorkflowLoadResult =
  | { state: "ready"; bundle: TechnicalSeoWorkflowBundle }
  | { state: "unconfigured" | "error" };

export class TechnicalSeoWorkflowService {
  constructor(private readonly source: TechnicalSeoWorkflowSource) {}
  async getSnapshotForMonth(requestedMonth: string | null): Promise<TechnicalSeoWorkflowBundle> {
    const monthOptions = await this.source.listAvailableMonths();
    const selected = resolveOperationsWorkflowMonthSelection(monthOptions, requestedMonth);
    if (!selected) throw new TechnicalSeoSourceUnavailableError("No dated Technical SEO workflow tab was found.");
    const sheet = await this.source.fetchTab(selected.tabTitle);
    return {
      items: parseTechnicalSeoWorkflowRows(sheet.rows, sheet.sourceTab), sourceTab: sheet.sourceTab,
      lastSyncedAt: new Date().toISOString(), monthOptions, selectedMonth: selected.value,
    };
  }
}

export async function loadTechnicalSeoWorkflow(requestedMonth: string | null): Promise<TechnicalSeoWorkflowLoadResult> {
  try {
    return { state: "ready", bundle: await new TechnicalSeoWorkflowService(createTechnicalSeoWorkflowSource()).getSnapshotForMonth(requestedMonth) };
  } catch (error) {
    if (error instanceof TechnicalSeoSourceNotConfiguredError) return { state: "unconfigured" };
    if (error instanceof TechnicalSeoSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

import "server-only";

import { parseOffPageSeoWorkflowRows, type OffPageOperationItem } from "../domain/operations/off-page-seo-workflow";
import {
  createOffPageSeoWorkflowSource,
  OffPageSeoSourceNotConfiguredError,
  OffPageSeoSourceUnavailableError,
  type OffPageSeoWorkflowSource,
} from "../lib/integrations/off-page-seo-workflow-source";
import {
  resolveOperationsWorkflowMonthSelection,
  type OperationsWorkflowMonthOption,
} from "../lib/integrations/operations-google-sheets";

export type OffPageSeoWorkflowSnapshot = {
  items: OffPageOperationItem[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type OffPageSeoWorkflowBundle = {
  snapshot: OffPageSeoWorkflowSnapshot;
  monthOptions: OperationsWorkflowMonthOption[];
  selectedMonth: string | null;
};

export type OffPageSeoWorkflowLoadResult =
  | { state: "ready"; bundle: OffPageSeoWorkflowBundle }
  | { state: "unconfigured" }
  | { state: "error" };

export class OffPageSeoWorkflowService {
  constructor(private readonly source: OffPageSeoWorkflowSource) {}

  async getSnapshotForMonth(requestedMonth: string | null): Promise<OffPageSeoWorkflowBundle> {
    const monthOptions = await this.source.listAvailableMonths();
    const selected = resolveOperationsWorkflowMonthSelection(monthOptions, requestedMonth);
    const sheet = selected ? await this.source.fetchTab(selected.tabTitle) : await this.source.fetchLatestTab();
    return {
      snapshot: {
        items: parseOffPageSeoWorkflowRows(sheet.rows, sheet.sourceTab),
        sourceTab: sheet.sourceTab,
        lastSyncedAt: new Date().toISOString(),
      },
      monthOptions,
      selectedMonth: selected?.value ?? null,
    };
  }
}

export async function loadOffPageSeoWorkflow(requestedMonth: string | null): Promise<OffPageSeoWorkflowLoadResult> {
  let source: OffPageSeoWorkflowSource;
  try {
    source = createOffPageSeoWorkflowSource();
  } catch (error) {
    if (error instanceof OffPageSeoSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }
  try {
    return { state: "ready", bundle: await new OffPageSeoWorkflowService(source).getSnapshotForMonth(requestedMonth) };
  } catch (error) {
    if (error instanceof OffPageSeoSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

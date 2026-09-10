import "server-only";

import { parseOnPageSeoWorkflowRows, type OnPageSeoOperationItem } from "../domain/operations/on-page-seo-workflow";
import {
  createOnPageSeoWorkflowSource,
  OnPageSeoSourceNotConfiguredError,
  OnPageSeoSourceUnavailableError,
  type OnPageSeoWorkflowSource,
} from "../lib/integrations/on-page-seo-workflow-source";
import {
  resolveOperationsWorkflowMonthSelection,
  type OperationsWorkflowMonthOption,
} from "../lib/integrations/operations-google-sheets";

export type OnPageSeoWorkflowSnapshot = {
  items: OnPageSeoOperationItem[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type OnPageSeoWorkflowBundle = {
  snapshot: OnPageSeoWorkflowSnapshot;
  monthOptions: OperationsWorkflowMonthOption[];
  selectedMonth: string | null;
};

export type OnPageSeoWorkflowLoadResult =
  | { state: "ready"; bundle: OnPageSeoWorkflowBundle }
  | { state: "unconfigured" }
  | { state: "error" };

export class OnPageSeoWorkflowService {
  constructor(private readonly source: OnPageSeoWorkflowSource) {}

  async getSnapshotForMonth(requestedMonth: string | null): Promise<OnPageSeoWorkflowBundle> {
    const monthOptions = await this.source.listAvailableMonths();
    const selected = resolveOperationsWorkflowMonthSelection(monthOptions, requestedMonth);
    const sheet = selected ? await this.source.fetchTab(selected.tabTitle) : await this.source.fetchLatestTab();
    return {
      snapshot: {
        items: parseOnPageSeoWorkflowRows(sheet.rows, sheet.sourceTab),
        sourceTab: sheet.sourceTab,
        lastSyncedAt: new Date().toISOString(),
      },
      monthOptions,
      selectedMonth: selected?.value ?? null,
    };
  }
}

export async function loadOnPageSeoWorkflow(requestedMonth: string | null): Promise<OnPageSeoWorkflowLoadResult> {
  let source: OnPageSeoWorkflowSource;
  try {
    source = createOnPageSeoWorkflowSource();
  } catch (error) {
    if (error instanceof OnPageSeoSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }
  try {
    return { state: "ready", bundle: await new OnPageSeoWorkflowService(source).getSnapshotForMonth(requestedMonth) };
  } catch (error) {
    if (error instanceof OnPageSeoSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

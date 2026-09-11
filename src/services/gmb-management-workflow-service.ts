import "server-only";

import { parseGmbManagementWorkflowRows, type GmbOperationItem } from "../domain/operations/gmb-management-workflow";
import {
  createGmbManagementWorkflowSource,
  GmbManagementSourceNotConfiguredError,
  GmbManagementSourceUnavailableError,
  type GmbManagementWorkflowSource,
} from "../lib/integrations/gmb-management-workflow-source";
import {
  resolveOperationsWorkflowMonthSelection,
  type OperationsWorkflowMonthOption,
} from "../lib/integrations/operations-google-sheets";

export type GmbManagementWorkflowSnapshot = {
  items: GmbOperationItem[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type GmbManagementWorkflowBundle = {
  snapshot: GmbManagementWorkflowSnapshot;
  monthOptions: OperationsWorkflowMonthOption[];
  selectedMonth: string | null;
};

export type GmbManagementWorkflowLoadResult =
  | { state: "ready"; bundle: GmbManagementWorkflowBundle }
  | { state: "unconfigured" }
  | { state: "error" };

export class GmbManagementWorkflowService {
  constructor(private readonly source: GmbManagementWorkflowSource) {}

  async getSnapshotForMonth(requestedMonth: string | null): Promise<GmbManagementWorkflowBundle> {
    const monthOptions = await this.source.listAvailableMonths();
    const selected = resolveOperationsWorkflowMonthSelection(monthOptions, requestedMonth);
    const sheet = selected ? await this.source.fetchTab(selected.tabTitle) : await this.source.fetchLatestTab();
    return {
      snapshot: {
        items: parseGmbManagementWorkflowRows(sheet.rows, sheet.sourceTab),
        sourceTab: sheet.sourceTab,
        lastSyncedAt: new Date().toISOString(),
      },
      monthOptions,
      selectedMonth: selected?.value ?? null,
    };
  }
}

export async function loadGmbManagementWorkflow(requestedMonth: string | null): Promise<GmbManagementWorkflowLoadResult> {
  let source: GmbManagementWorkflowSource;
  try {
    source = createGmbManagementWorkflowSource();
  } catch (error) {
    if (error instanceof GmbManagementSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }
  try {
    return { state: "ready", bundle: await new GmbManagementWorkflowService(source).getSnapshotForMonth(requestedMonth) };
  } catch (error) {
    if (error instanceof GmbManagementSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

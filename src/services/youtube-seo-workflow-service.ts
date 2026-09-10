import "server-only";

import { parseYoutubeSeoWorkflowRows, type YoutubeOperationItem } from "../domain/operations/youtube-seo-workflow";
import {
  createYoutubeSeoWorkflowSource,
  YoutubeSeoSourceNotConfiguredError,
  YoutubeSeoSourceUnavailableError,
  type YoutubeSeoWorkflowSource,
} from "../lib/integrations/youtube-seo-workflow-source";
import {
  resolveOperationsWorkflowMonthSelection,
  type OperationsWorkflowMonthOption,
} from "../lib/integrations/operations-google-sheets";

export type YoutubeSeoWorkflowSnapshot = {
  items: YoutubeOperationItem[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type YoutubeSeoWorkflowBundle = {
  snapshot: YoutubeSeoWorkflowSnapshot;
  monthOptions: OperationsWorkflowMonthOption[];
  selectedMonth: string | null;
};

export type YoutubeSeoWorkflowLoadResult =
  | { state: "ready"; bundle: YoutubeSeoWorkflowBundle }
  | { state: "unconfigured" }
  | { state: "error" };

export class YoutubeSeoWorkflowService {
  constructor(private readonly source: YoutubeSeoWorkflowSource) {}

  async getSnapshotForMonth(requestedMonth: string | null): Promise<YoutubeSeoWorkflowBundle> {
    const monthOptions = await this.source.listAvailableMonths();
    const selected = resolveOperationsWorkflowMonthSelection(monthOptions, requestedMonth);
    const sheet = selected ? await this.source.fetchTab(selected.tabTitle) : await this.source.fetchLatestTab();
    return {
      snapshot: {
        items: parseYoutubeSeoWorkflowRows(sheet.rows, sheet.sourceTab),
        sourceTab: sheet.sourceTab,
        lastSyncedAt: new Date().toISOString(),
      },
      monthOptions,
      selectedMonth: selected?.value ?? null,
    };
  }
}

export async function loadYoutubeSeoWorkflow(requestedMonth: string | null): Promise<YoutubeSeoWorkflowLoadResult> {
  let source: YoutubeSeoWorkflowSource;
  try {
    source = createYoutubeSeoWorkflowSource();
  } catch (error) {
    if (error instanceof YoutubeSeoSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }
  try {
    return { state: "ready", bundle: await new YoutubeSeoWorkflowService(source).getSnapshotForMonth(requestedMonth) };
  } catch (error) {
    if (error instanceof YoutubeSeoSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

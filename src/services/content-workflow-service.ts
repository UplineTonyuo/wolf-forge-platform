import "server-only";

import {
  parseContentWorkflowRows,
  type ContentOperationItem,
} from "../domain/operations/content-workflow";
import {
  ContentSourceNotConfiguredError,
  ContentSourceUnavailableError,
  createContentWorkflowSource,
  type ContentWorkflowSource,
} from "../lib/integrations/content-workflow-source";

export type ContentWorkflowSnapshot = {
  items: ContentOperationItem[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type ContentWorkflowLoadResult =
  | { state: "ready"; snapshot: ContentWorkflowSnapshot }
  | { state: "unconfigured" }
  | { state: "error" };

export class ContentWorkflowService {
  constructor(private readonly source: ContentWorkflowSource) {}

  async getSnapshot(): Promise<ContentWorkflowSnapshot> {
    const { sourceTab, rows } = await this.source.fetchLatestContentTab();
    return {
      items: parseContentWorkflowRows(rows, sourceTab),
      sourceTab,
      lastSyncedAt: new Date().toISOString(),
    };
  }
}

export async function loadContentWorkflow(): Promise<ContentWorkflowLoadResult> {
  let source: ContentWorkflowSource;
  try {
    source = createContentWorkflowSource();
  } catch (error) {
    if (error instanceof ContentSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }

  try {
    const snapshot = await new ContentWorkflowService(source).getSnapshot();
    return { state: "ready", snapshot };
  } catch (error) {
    if (error instanceof ContentSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

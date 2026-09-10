import "server-only";

import { parseWebsiteBuilderWorkflowRows, type WebsiteBuilderProject } from "../domain/operations/website-builder-workflow";
import {
  createWebsiteBuilderWorkflowSource,
  WebsiteBuilderSourceNotConfiguredError,
  WebsiteBuilderSourceUnavailableError,
  type WebsiteBuilderWorkflowSource,
} from "../lib/integrations/website-builder-workflow-source";

export type WebsiteBuilderWorkflowSnapshot = {
  projects: WebsiteBuilderProject[];
  sourceTab: string;
  lastSyncedAt: string;
};

export type WebsiteBuilderWorkflowLoadResult =
  | { state: "ready"; snapshot: WebsiteBuilderWorkflowSnapshot }
  | { state: "unconfigured" }
  | { state: "error" };

export class WebsiteBuilderWorkflowService {
  constructor(private readonly source: WebsiteBuilderWorkflowSource) {}

  async getSnapshot(): Promise<WebsiteBuilderWorkflowSnapshot> {
    const sheet = await this.source.fetchLatestTab();
    return {
      projects: parseWebsiteBuilderWorkflowRows(sheet.rows, sheet.sourceTab),
      sourceTab: sheet.sourceTab,
      lastSyncedAt: new Date().toISOString(),
    };
  }
}

export async function loadWebsiteBuilderWorkflow(): Promise<WebsiteBuilderWorkflowLoadResult> {
  let source: WebsiteBuilderWorkflowSource;
  try {
    source = createWebsiteBuilderWorkflowSource();
  } catch (error) {
    if (error instanceof WebsiteBuilderSourceNotConfiguredError) return { state: "unconfigured" };
    throw error;
  }
  try {
    return { state: "ready", snapshot: await new WebsiteBuilderWorkflowService(source).getSnapshot() };
  } catch (error) {
    if (error instanceof WebsiteBuilderSourceUnavailableError) return { state: "error" };
    throw error;
  }
}

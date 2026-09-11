import "server-only";

import { locateWebsiteBuilderLinkColumns } from "../../domain/operations/website-builder-workflow";
import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import {
  readWebsiteBuilderGoogleSheetsEnvironment,
  type WebsiteBuilderGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
} from "./operations-google-sheets";

export const WEBSITE_BUILDER_WORKFLOW_CACHE_TAG = "website-builder-workflow-sheet";

/**
 * Unlike Podcast/Content/GMB/YouTube, this workbook isn't organized into
 * monthly tabs today — the live pipeline lives in one running queue tab.
 * `WEB BUILD ORDER` is read by exact title (an ordinary tab-title read, the
 * same resilient mechanism every other department already uses — not a
 * hardcoded gid). If the workbook is ever reorganized into dated tabs, the
 * fallback below picks the latest one automatically without code changes.
 */
const CANONICAL_TAB_TITLE = "WEB BUILD ORDER";

export type WebsiteBuilderWorkflowSheet = { sourceTab: string; rows: string[][] };

export interface WebsiteBuilderWorkflowSource {
  fetchLatestTab(): Promise<WebsiteBuilderWorkflowSheet>;
}

export class WebsiteBuilderSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The Website Builder workflow source is not configured.", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WebsiteBuilderSourceNotConfiguredError";
  }
}

export class WebsiteBuilderSourceUnavailableError extends Error {
  readonly stage: string;
  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WebsiteBuilderSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

export class GoogleSheetsWebsiteBuilderWorkflowSource implements WebsiteBuilderWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: WebsiteBuilderGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, WEBSITE_BUILDER_WORKFLOW_CACHE_TAG, fetcher);
  }

  async fetchLatestTab(): Promise<WebsiteBuilderWorkflowSheet> {
    try {
      const tabs = await this.reader.listTabs(this.environment.WEBSITE_BUILDER_SPREADSHEET_ID);
      const canonical = tabs.find((tab) => tab.title.trim().toLowerCase() === CANONICAL_TAB_TITLE.toLowerCase());
      const sourceTab = canonical?.title ?? selectLatestOperationsWorkflowTab(tabs, "WEB BUILD");
      if (!sourceTab) throw new WebsiteBuilderSourceUnavailableError("No Website Builder workflow tab was found.", { stage: "tab_detection" });
      return await this.fetchTab(sourceTab);
    } catch (error) {
      if (error instanceof WebsiteBuilderSourceUnavailableError) throw error;
      throw this.asUnavailable(error);
    }
  }

  private async fetchTab(sourceTab: string): Promise<WebsiteBuilderWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(this.environment.WEBSITE_BUILDER_SPREADSHEET_ID, sourceTab);
      const linkColumns = locateWebsiteBuilderLinkColumns(rawRows);
      const hyperlinks = linkColumns.length > 0
        ? await this.reader.readCellHyperlinks(
            this.environment.WEBSITE_BUILDER_SPREADSHEET_ID,
            sourceTab,
            linkColumns,
            rawRows.length,
          )
        : new Map<string, string>();
      return { sourceTab, rows: applyCellHyperlinks(rawRows, hyperlinks) };
    } catch (error) {
      throw this.asUnavailable(error);
    }
  }

  private asUnavailable(error: unknown): WebsiteBuilderSourceUnavailableError {
    if (error instanceof WebsiteBuilderSourceUnavailableError) return error;
    if (error instanceof OperationsGoogleSheetsReadError) {
      return new WebsiteBuilderSourceUnavailableError(error.message, { cause: error, stage: error.stage });
    }
    return new WebsiteBuilderSourceUnavailableError("The Website Builder workflow could not be read.", { cause: error });
  }
}

export function createWebsiteBuilderWorkflowSource(): WebsiteBuilderWorkflowSource {
  let environment: WebsiteBuilderGoogleSheetsEnvironment;
  try {
    environment = readWebsiteBuilderGoogleSheetsEnvironment();
  } catch (error) {
    throw new WebsiteBuilderSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsWebsiteBuilderWorkflowSource(environment);
}

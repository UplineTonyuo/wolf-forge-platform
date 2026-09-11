import "server-only";

import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import { locateContentUrlColumns } from "../../domain/operations/content-workflow";
import {
  readContentGoogleSheetsEnvironment,
  type ContentGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
} from "./operations-google-sheets";

export const CONTENT_WORKFLOW_CACHE_TAG = "content-workflow-sheet";

export type ContentWorkflowSheet = {
  sourceTab: string;
  rows: string[][];
};

export interface ContentWorkflowSource {
  fetchLatestContentTab(): Promise<ContentWorkflowSheet>;
}

export class ContentSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "The Content workflow source is not configured.",
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "ContentSourceNotConfiguredError";
  }
}

export class ContentSourceUnavailableError extends Error {
  readonly stage: string;

  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ContentSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

export class GoogleSheetsContentWorkflowSource implements ContentWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: ContentGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, CONTENT_WORKFLOW_CACHE_TAG, fetcher);
  }

  async fetchLatestContentTab(): Promise<ContentWorkflowSheet> {
    try {
      const tabs = await this.reader.listTabs(this.environment.CONTENT_WORKFLOW_SPREADSHEET_ID);
      const sourceTab = selectLatestOperationsWorkflowTab(tabs, "CONTENT");
      if (!sourceTab) {
        throw new ContentSourceUnavailableError("No Content workflow tab was found.", {
          stage: "tab_detection",
        });
      }
      const rawRows = await this.reader.readTabValues(
        this.environment.CONTENT_WORKFLOW_SPREADSHEET_ID,
        sourceTab,
      );

      const urlColumns = locateContentUrlColumns(rawRows);
      const hyperlinks =
        urlColumns.length > 0
          ? await this.reader.readCellHyperlinks(
              this.environment.CONTENT_WORKFLOW_SPREADSHEET_ID,
              sourceTab,
              urlColumns,
              rawRows.length,
            )
          : new Map<string, string>();
      const rows = applyCellHyperlinks(rawRows, hyperlinks);
      return { sourceTab, rows };
    } catch (error) {
      if (error instanceof ContentSourceUnavailableError) throw error;
      if (error instanceof OperationsGoogleSheetsReadError) {
        throw new ContentSourceUnavailableError(error.message, {
          cause: error,
          stage: error.stage,
        });
      }
      throw error;
    }
  }
}

export function createContentWorkflowSource(): ContentWorkflowSource {
  let environment: ContentGoogleSheetsEnvironment;
  try {
    environment = readContentGoogleSheetsEnvironment();
  } catch (error) {
    throw new ContentSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsContentWorkflowSource(environment);
}

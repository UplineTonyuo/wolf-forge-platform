import "server-only";

import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import { locateOnPageSeoLinkColumns } from "../../domain/operations/on-page-seo-workflow";
import {
  readOnPageSeoGoogleSheetsEnvironment,
  type OnPageSeoGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  buildOperationsWorkflowMonthOptions,
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
  type OperationsWorkflowMonthOption,
} from "./operations-google-sheets";

export const ON_PAGE_SEO_WORKFLOW_CACHE_TAG = "on-page-seo-workflow-sheet";

export type OnPageSeoWorkflowSheet = { sourceTab: string; rows: string[][] };

export interface OnPageSeoWorkflowSource {
  listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]>;
  fetchLatestTab(): Promise<OnPageSeoWorkflowSheet>;
  fetchTab(tabTitle: string): Promise<OnPageSeoWorkflowSheet>;
}

export class OnPageSeoSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The On-page SEO workflow source is not configured.", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OnPageSeoSourceNotConfiguredError";
  }
}

export class OnPageSeoSourceUnavailableError extends Error {
  readonly stage: string;
  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OnPageSeoSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

export class GoogleSheetsOnPageSeoWorkflowSource implements OnPageSeoWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: OnPageSeoGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, ON_PAGE_SEO_WORKFLOW_CACHE_TAG, fetcher);
  }

  async listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]> {
    try {
      const tabs = await this.reader.listTabs(this.environment.ON_PAGE_SEO_SPREADSHEET_ID);
      return buildOperationsWorkflowMonthOptions(tabs, "ONPAGE");
    } catch (error) {
      throw this.asUnavailable(error);
    }
  }

  async fetchLatestTab(): Promise<OnPageSeoWorkflowSheet> {
    try {
      const tabs = await this.reader.listTabs(this.environment.ON_PAGE_SEO_SPREADSHEET_ID);
      const sourceTab = selectLatestOperationsWorkflowTab(
        tabs.filter((tab) => tab.title.trim().toLowerCase().replace(/\s+/g, "").startsWith("onpage")),
        "ONPAGE",
      );
      if (!sourceTab) throw new OnPageSeoSourceUnavailableError("No On-page SEO workflow tab was found.", { stage: "tab_detection" });
      return await this.fetchTab(sourceTab);
    } catch (error) {
      if (error instanceof OnPageSeoSourceUnavailableError) throw error;
      throw this.asUnavailable(error);
    }
  }

  async fetchTab(sourceTab: string): Promise<OnPageSeoWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(
        this.environment.ON_PAGE_SEO_SPREADSHEET_ID,
        sourceTab,
      );
      const linkColumns = locateOnPageSeoLinkColumns(rawRows);
      const hyperlinks = linkColumns.length > 0
        ? await this.reader.readCellHyperlinks(
            this.environment.ON_PAGE_SEO_SPREADSHEET_ID,
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

  private asUnavailable(error: unknown): OnPageSeoSourceUnavailableError {
    if (error instanceof OnPageSeoSourceUnavailableError) return error;
    if (error instanceof OperationsGoogleSheetsReadError) {
      return new OnPageSeoSourceUnavailableError(error.message, { cause: error, stage: error.stage });
    }
    return new OnPageSeoSourceUnavailableError("The On-page SEO workflow could not be read.", { cause: error });
  }
}

export function createOnPageSeoWorkflowSource(): OnPageSeoWorkflowSource {
  let environment: OnPageSeoGoogleSheetsEnvironment;
  try {
    environment = readOnPageSeoGoogleSheetsEnvironment();
  } catch (error) {
    throw new OnPageSeoSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsOnPageSeoWorkflowSource(environment);
}

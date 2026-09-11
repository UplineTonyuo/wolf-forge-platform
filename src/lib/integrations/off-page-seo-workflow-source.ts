import "server-only";

import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import { locateOffPageSeoLinkColumns } from "../../domain/operations/off-page-seo-workflow";
import {
  readOffPageSeoGoogleSheetsEnvironment,
  type OffPageSeoGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  buildOperationsWorkflowMonthOptions,
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
  type OperationsWorkflowMonthOption,
} from "./operations-google-sheets";

export const OFF_PAGE_SEO_WORKFLOW_CACHE_TAG = "off-page-seo-workflow-sheet";

export type OffPageSeoWorkflowSheet = { sourceTab: string; rows: string[][] };

export interface OffPageSeoWorkflowSource {
  listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]>;
  fetchLatestTab(): Promise<OffPageSeoWorkflowSheet>;
  fetchTab(tabTitle: string): Promise<OffPageSeoWorkflowSheet>;
}

export class OffPageSeoSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The Off-page SEO workflow source is not configured.", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OffPageSeoSourceNotConfiguredError";
  }
}

export class OffPageSeoSourceUnavailableError extends Error {
  readonly stage: string;
  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OffPageSeoSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

export class GoogleSheetsOffPageSeoWorkflowSource implements OffPageSeoWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: OffPageSeoGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, OFF_PAGE_SEO_WORKFLOW_CACHE_TAG, fetcher);
  }

  async listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]> {
    try {
      const tabs = await this.reader.listTabs(this.environment.OFF_PAGE_SEO_SPREADSHEET_ID);
      return buildOperationsWorkflowMonthOptions(tabs, "OFF PAGE SEO");
    } catch (error) {
      throw this.asUnavailable(error);
    }
  }

  async fetchLatestTab(): Promise<OffPageSeoWorkflowSheet> {
    try {
      const tabs = await this.reader.listTabs(this.environment.OFF_PAGE_SEO_SPREADSHEET_ID);
      const sourceTab = selectLatestOperationsWorkflowTab(
        tabs.filter((tab) => tab.title.trim().toLowerCase().replace(/\s+/g, "").startsWith("offpageseo")),
        "OFF PAGE SEO",
      );
      if (!sourceTab) throw new OffPageSeoSourceUnavailableError("No Off-page SEO workflow tab was found.", { stage: "tab_detection" });
      return await this.fetchTab(sourceTab);
    } catch (error) {
      if (error instanceof OffPageSeoSourceUnavailableError) throw error;
      throw this.asUnavailable(error);
    }
  }

  async fetchTab(sourceTab: string): Promise<OffPageSeoWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(
        this.environment.OFF_PAGE_SEO_SPREADSHEET_ID,
        sourceTab,
      );
      const linkColumns = locateOffPageSeoLinkColumns(rawRows);
      const hyperlinks = linkColumns.length > 0
        ? await this.reader.readCellHyperlinks(
            this.environment.OFF_PAGE_SEO_SPREADSHEET_ID,
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

  private asUnavailable(error: unknown): OffPageSeoSourceUnavailableError {
    if (error instanceof OffPageSeoSourceUnavailableError) return error;
    if (error instanceof OperationsGoogleSheetsReadError) {
      return new OffPageSeoSourceUnavailableError(error.message, { cause: error, stage: error.stage });
    }
    return new OffPageSeoSourceUnavailableError("The Off-page SEO workflow could not be read.", { cause: error });
  }
}

export function createOffPageSeoWorkflowSource(): OffPageSeoWorkflowSource {
  let environment: OffPageSeoGoogleSheetsEnvironment;
  try {
    environment = readOffPageSeoGoogleSheetsEnvironment();
  } catch (error) {
    throw new OffPageSeoSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsOffPageSeoWorkflowSource(environment);
}

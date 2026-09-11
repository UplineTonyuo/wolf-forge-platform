import "server-only";

import { locateGmbManagementLinkColumns } from "../../domain/operations/gmb-management-workflow";
import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import {
  readGmbManagementGoogleSheetsEnvironment,
  type GmbManagementGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  buildOperationsWorkflowMonthOptions,
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
  type OperationsSheetTab,
  type OperationsWorkflowMonthOption,
} from "./operations-google-sheets";

export const GMB_MANAGEMENT_WORKFLOW_CACHE_TAG = "gmb-management-workflow-sheet";

export type GmbManagementWorkflowSheet = { sourceTab: string; rows: string[][] };

export interface GmbManagementWorkflowSource {
  listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]>;
  fetchLatestTab(): Promise<GmbManagementWorkflowSheet>;
  fetchTab(tabTitle: string): Promise<GmbManagementWorkflowSheet>;
}

export class GmbManagementSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The GMB Management workflow source is not configured.", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GmbManagementSourceNotConfiguredError";
  }
}

export class GmbManagementSourceUnavailableError extends Error {
  readonly stage: string;
  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GmbManagementSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

const MONTH_ONLY_TITLE = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}$/i;

function gmbMonthTabs(tabs: readonly OperationsSheetTab[]): OperationsSheetTab[] {
  return tabs.filter((tab) => {
    const title = tab.title.trim().replace(/\s+/g, " ");
    return MONTH_ONLY_TITLE.test(title) || /^gmb\b/i.test(title);
  });
}

export class GoogleSheetsGmbManagementWorkflowSource implements GmbManagementWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: GmbManagementGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, GMB_MANAGEMENT_WORKFLOW_CACHE_TAG, fetcher);
  }

  async listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]> {
    try {
      const tabs = gmbMonthTabs(await this.reader.listTabs(this.environment.GMB_MANAGEMENT_SPREADSHEET_ID));
      return buildOperationsWorkflowMonthOptions(tabs, "");
    } catch (error) {
      throw this.asUnavailable(error);
    }
  }

  async fetchLatestTab(): Promise<GmbManagementWorkflowSheet> {
    try {
      const tabs = gmbMonthTabs(await this.reader.listTabs(this.environment.GMB_MANAGEMENT_SPREADSHEET_ID));
      const sourceTab = selectLatestOperationsWorkflowTab(tabs, "GMB");
      if (!sourceTab) throw new GmbManagementSourceUnavailableError("No GMB Management workflow tab was found.", { stage: "tab_detection" });
      return await this.fetchTab(sourceTab);
    } catch (error) {
      if (error instanceof GmbManagementSourceUnavailableError) throw error;
      throw this.asUnavailable(error);
    }
  }

  async fetchTab(sourceTab: string): Promise<GmbManagementWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(this.environment.GMB_MANAGEMENT_SPREADSHEET_ID, sourceTab);
      const linkColumns = locateGmbManagementLinkColumns(rawRows);
      const hyperlinks = linkColumns.length > 0
        ? await this.reader.readCellHyperlinks(
            this.environment.GMB_MANAGEMENT_SPREADSHEET_ID,
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

  private asUnavailable(error: unknown): GmbManagementSourceUnavailableError {
    if (error instanceof GmbManagementSourceUnavailableError) return error;
    if (error instanceof OperationsGoogleSheetsReadError) {
      return new GmbManagementSourceUnavailableError(error.message, { cause: error, stage: error.stage });
    }
    return new GmbManagementSourceUnavailableError("The GMB Management workflow could not be read.", { cause: error });
  }
}

export function createGmbManagementWorkflowSource(): GmbManagementWorkflowSource {
  let environment: GmbManagementGoogleSheetsEnvironment;
  try {
    environment = readGmbManagementGoogleSheetsEnvironment();
  } catch (error) {
    throw new GmbManagementSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsGmbManagementWorkflowSource(environment);
}

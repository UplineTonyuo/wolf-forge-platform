import "server-only";

import { locateTechnicalSeoLinkColumns } from "../../domain/operations/technical-seo-workflow";
import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import { readTechnicalSeoGoogleSheetsEnvironment, type TechnicalSeoGoogleSheetsEnvironment } from "../env/google-sheets-env";
import { buildOperationsWorkflowMonthOptions, OperationsGoogleSheetsReader, type OperationsWorkflowMonthOption } from "./operations-google-sheets";

export const TECHNICAL_SEO_CACHE_TAG = "technical-seo-workflow-sheet";
export type TechnicalSeoSheet = { sourceTab: string; rows: string[][] };
export interface TechnicalSeoWorkflowSource {
  listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]>;
  fetchTab(sourceTab: string): Promise<TechnicalSeoSheet>;
}
export class TechnicalSeoSourceNotConfiguredError extends Error {}
export class TechnicalSeoSourceUnavailableError extends Error {}

export class GoogleSheetsTechnicalSeoWorkflowSource implements TechnicalSeoWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;
  constructor(private readonly environment: TechnicalSeoGoogleSheetsEnvironment, fetcher: typeof fetch = fetch) {
    this.reader = new OperationsGoogleSheetsReader(environment, TECHNICAL_SEO_CACHE_TAG, fetcher);
  }
  async listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]> {
    try {
      const tabs = await this.reader.listTabs(this.environment.TECHNICAL_SEO_SPREADSHEET_ID);
      // Explicit years disambiguate the current monthly workflow from old undated department snapshots.
      // Shared ranking resolves duplicate month titles by later workbook index, never hardcoded gids.
      return buildOperationsWorkflowMonthOptions(tabs, "Technical SEO");
    } catch (cause) {
      throw new TechnicalSeoSourceUnavailableError("Technical SEO workbook metadata could not be read.", { cause });
    }
  }
  async fetchTab(sourceTab: string): Promise<TechnicalSeoSheet> {
    try {
      const id = this.environment.TECHNICAL_SEO_SPREADSHEET_ID;
      const rawRows = await this.reader.readTabValues(id, sourceTab);
      const columns = locateTechnicalSeoLinkColumns(rawRows);
      const hyperlinks = rawRows.length ? await this.reader.readCellHyperlinks(id, sourceTab, columns, rawRows.length) : new Map<string, string>();
      return { sourceTab, rows: applyCellHyperlinks(rawRows, hyperlinks) };
    } catch (cause) {
      throw new TechnicalSeoSourceUnavailableError("Technical SEO workflow could not be read.", { cause });
    }
  }
}

export function createTechnicalSeoWorkflowSource(): TechnicalSeoWorkflowSource {
  let environment: TechnicalSeoGoogleSheetsEnvironment;
  try { environment = readTechnicalSeoGoogleSheetsEnvironment(); }
  catch (cause) { throw new TechnicalSeoSourceNotConfiguredError("Technical SEO source is not configured.", { cause }); }
  return new GoogleSheetsTechnicalSeoWorkflowSource(environment);
}

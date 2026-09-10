import "server-only";

import { locateYoutubeSeoLinkColumns } from "../../domain/operations/youtube-seo-workflow";
import { applyCellHyperlinks } from "../../domain/operations/podcast-workflow";
import {
  readYoutubeSeoGoogleSheetsEnvironment,
  type YoutubeSeoGoogleSheetsEnvironment,
} from "../env/google-sheets-env";
import {
  buildOperationsWorkflowMonthOptions,
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  selectLatestOperationsWorkflowTab,
  type OperationsSheetTab,
  type OperationsWorkflowMonthOption,
} from "./operations-google-sheets";

export const YOUTUBE_SEO_WORKFLOW_CACHE_TAG = "youtube-seo-workflow-sheet";

export type YoutubeSeoWorkflowSheet = { sourceTab: string; rows: string[][] };

export interface YoutubeSeoWorkflowSource {
  listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]>;
  fetchLatestTab(): Promise<YoutubeSeoWorkflowSheet>;
  fetchTab(tabTitle: string): Promise<YoutubeSeoWorkflowSheet>;
}

export class YoutubeSeoSourceNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The YouTube SEO workflow source is not configured.", options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YoutubeSeoSourceNotConfiguredError";
  }
}

export class YoutubeSeoSourceUnavailableError extends Error {
  readonly stage: string;
  constructor(message: string, options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YoutubeSeoSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
  }
}

// Dated tabs read "YT SEO <Month> <Year>" (e.g. "YT SEO September 2026"), not
// "<Month> <Year>" like Podcast/GMB, so the month name doesn't lead the title.
const YT_SEO_DATED_TITLE = /^yt\s*seo\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}$/i;

function youtubeSeoMonthTabs(tabs: readonly OperationsSheetTab[]): OperationsSheetTab[] {
  return tabs.filter((tab) => {
    const title = tab.title.trim().replace(/\s+/g, " ");
    return YT_SEO_DATED_TITLE.test(title) || /^youtube\s*seo\b/i.test(title);
  });
}

export class GoogleSheetsYoutubeSeoWorkflowSource implements YoutubeSeoWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: YoutubeSeoGoogleSheetsEnvironment,
    fetcher: typeof fetch = fetch,
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, YOUTUBE_SEO_WORKFLOW_CACHE_TAG, fetcher);
  }

  async listAvailableMonths(): Promise<OperationsWorkflowMonthOption[]> {
    try {
      const tabs = youtubeSeoMonthTabs(await this.reader.listTabs(this.environment.YOUTUBE_SEO_SPREADSHEET_ID));
      return buildOperationsWorkflowMonthOptions(tabs, "");
    } catch (error) {
      throw this.asUnavailable(error);
    }
  }

  async fetchLatestTab(): Promise<YoutubeSeoWorkflowSheet> {
    try {
      const tabs = youtubeSeoMonthTabs(await this.reader.listTabs(this.environment.YOUTUBE_SEO_SPREADSHEET_ID));
      const sourceTab = selectLatestOperationsWorkflowTab(tabs, "YT SEO");
      if (!sourceTab) throw new YoutubeSeoSourceUnavailableError("No YouTube SEO workflow tab was found.", { stage: "tab_detection" });
      return await this.fetchTab(sourceTab);
    } catch (error) {
      if (error instanceof YoutubeSeoSourceUnavailableError) throw error;
      throw this.asUnavailable(error);
    }
  }

  async fetchTab(sourceTab: string): Promise<YoutubeSeoWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(this.environment.YOUTUBE_SEO_SPREADSHEET_ID, sourceTab);
      const linkColumns = locateYoutubeSeoLinkColumns(rawRows);
      const hyperlinks = linkColumns.length > 0
        ? await this.reader.readCellHyperlinks(
            this.environment.YOUTUBE_SEO_SPREADSHEET_ID,
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

  private asUnavailable(error: unknown): YoutubeSeoSourceUnavailableError {
    if (error instanceof YoutubeSeoSourceUnavailableError) return error;
    if (error instanceof OperationsGoogleSheetsReadError) {
      return new YoutubeSeoSourceUnavailableError(error.message, { cause: error, stage: error.stage });
    }
    return new YoutubeSeoSourceUnavailableError("The YouTube SEO workflow could not be read.", { cause: error });
  }
}

export function createYoutubeSeoWorkflowSource(): YoutubeSeoWorkflowSource {
  let environment: YoutubeSeoGoogleSheetsEnvironment;
  try {
    environment = readYoutubeSeoGoogleSheetsEnvironment();
  } catch (error) {
    throw new YoutubeSeoSourceNotConfiguredError({ cause: error });
  }
  return new GoogleSheetsYoutubeSeoWorkflowSource(environment);
}

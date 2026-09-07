import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentWorkflowService } from "../services/content-workflow-service";
import {
  createContentWorkflowSource,
  ContentSourceNotConfiguredError,
  type ContentWorkflowSheet,
  type ContentWorkflowSource,
} from "../lib/integrations/content-workflow-source";
import { isContentWorkflowSourceConfigured } from "../lib/env/google-sheets-env";
import { selectLatestOperationsWorkflowTab } from "../lib/integrations/operations-google-sheets";

class FakeContentSource implements ContentWorkflowSource {
  constructor(private readonly sheet: ContentWorkflowSheet) {}
  async fetchLatestContentTab(): Promise<ContentWorkflowSheet> {
    return this.sheet;
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("Content workflow configuration", () => {
  it("treats a missing future workbook id as unconfigured before any network call", () => {
    const credentialsOnly = {
      GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "reader@example.iam.gserviceaccount.com",
      GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: "not-a-real-test-key",
    };
    expect(isContentWorkflowSourceConfigured(credentialsOnly)).toBe(false);

    vi.stubEnv("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY", "");
    vi.stubEnv("CONTENT_WORKFLOW_SPREADSHEET_ID", "");
    expect(() => createContentWorkflowSource()).toThrow(ContentSourceNotConfiguredError);
  });

  it("recognizes the complete future configuration contract", () => {
    expect(isContentWorkflowSourceConfigured({
      GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "reader@example.iam.gserviceaccount.com",
      GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: "test-key-shape-only",
      CONTENT_WORKFLOW_SPREADSHEET_ID: "content-sheet-id",
    })).toBe(true);
  });
});

describe("ContentWorkflowService", () => {
  it("parses a source snapshot and stamps its read time", async () => {
    const service = new ContentWorkflowService(new FakeContentSource({
      sourceTab: "CONTENT AUGUST 2026",
      rows: [
        ["Website", "Status"],
        ["https://acme.example.com", "Completed"],
      ],
    }));

    const snapshot = await service.getSnapshot();
    expect(snapshot.sourceTab).toBe("CONTENT AUGUST 2026");
    expect(snapshot.items[0]).toMatchObject({ website: "https://acme.example.com", normalizedStatus: "completed" });
    expect(() => new Date(snapshot.lastSyncedAt).toISOString()).not.toThrow();
  });
});

describe("Content monthly tab selection", () => {
  it("selects the newest dated Content tab without hard-coding a month", () => {
    expect(selectLatestOperationsWorkflowTab([
      { title: "CONTENT JULY 2026", index: 8 },
      { title: "CONTENT AUGUST 2026", index: 2 },
      { title: "Notes", index: 20 },
    ], "CONTENT")).toBe("CONTENT AUGUST 2026");
  });

  it("supports month-only tab names in a Content-only workbook", () => {
    expect(selectLatestOperationsWorkflowTab([
      { title: "CONTENT TEMPLATE", index: 20 },
      { title: "July 2026", index: 0 },
      { title: "August 2026", index: 1 },
    ], "CONTENT")).toBe("August 2026");
  });
});

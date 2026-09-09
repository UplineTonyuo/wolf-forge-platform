import { describe, expect, it } from "vitest";
import { PodcastWorkflowService } from "../services/podcast-workflow-service";
import {
  PodcastSourceUnavailableError,
  type PodcastMonthOption,
  type PodcastWorkflowSheet,
  type PodcastWorkflowSource,
} from "../lib/integrations/google-sheets-source";
import { createPodcastWorkflowSource } from "../lib/integrations/google-sheets-source";
import { isGoogleSheetsSourceConfigured } from "../lib/env/google-sheets-env";

class FakeSource implements PodcastWorkflowSource {
  fetchPodcastTabCalls: string[] = [];
  fetchLatestCallCount = 0;

  constructor(
    private readonly sheet: PodcastWorkflowSheet | (() => Promise<PodcastWorkflowSheet>),
    private readonly monthOptions: PodcastMonthOption[] = [],
    private readonly sheetsByTab: Record<string, PodcastWorkflowSheet> = {},
  ) {}
  async fetchLatestPodcastTab(): Promise<PodcastWorkflowSheet> {
    this.fetchLatestCallCount += 1;
    return typeof this.sheet === "function" ? this.sheet() : this.sheet;
  }
  async listAvailablePodcastMonths(): Promise<PodcastMonthOption[]> {
    return this.monthOptions;
  }
  async fetchPodcastTab(tabTitle: string): Promise<PodcastWorkflowSheet> {
    this.fetchPodcastTabCalls.push(tabTitle);
    const bySheet = this.sheetsByTab[tabTitle];
    if (bySheet) return bySheet;
    return typeof this.sheet === "function" ? this.sheet() : this.sheet;
  }
}

const HEADER = ["Name", "Status 1", "Notes"];

describe("PodcastWorkflowService", () => {
  it("parses the source's rows into canonical items and stamps a sync time", async () => {
    const source = new FakeSource({
      sourceMonth: "PODCAST AUGUST 2026",
      rows: [HEADER, ["Acme Co", "Completed", ""]],
    });
    const service = new PodcastWorkflowService(source);

    const snapshot = await service.getSnapshot();

    expect(snapshot.sourceMonth).toBe("PODCAST AUGUST 2026");
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({ clientName: "Acme Co", normalizedStatus: "completed" });
    expect(() => new Date(snapshot.lastSyncedAt).toISOString()).not.toThrow();
  });

  it("propagates a source-unavailable failure rather than returning an empty snapshot", async () => {
    const source = new FakeSource(async () => {
      throw new PodcastSourceUnavailableError("Could not read the Podcast SEO tab's data.");
    });
    const service = new PodcastWorkflowService(source);

    await expect(service.getSnapshot()).rejects.toBeInstanceOf(PodcastSourceUnavailableError);
  });
});

describe("PodcastWorkflowService.getSnapshotForMonth", () => {
  const monthOptions: PodcastMonthOption[] = [
    { value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" },
    { value: "2026-07", label: "July 2026", tabTitle: "PODCAST JULY 2026" },
  ];

  it("fetches the exact tab matching a valid requested month, never the newest by default", async () => {
    const source = new FakeSource(
      { sourceMonth: "PODCAST AUGUST 2026", rows: [HEADER] },
      monthOptions,
      { "PODCAST JULY 2026": { sourceMonth: "PODCAST JULY 2026", rows: [HEADER, ["Beta LLC", "Stuck", ""]] } },
    );
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth("2026-07");

    expect(source.fetchPodcastTabCalls).toEqual(["PODCAST JULY 2026"]);
    expect(source.fetchLatestCallCount).toBe(0);
    expect(bundle.selectedMonth).toBe("2026-07");
    expect(bundle.monthOptions).toEqual(monthOptions);
    expect(bundle.snapshot.sourceMonth).toBe("PODCAST JULY 2026");
    expect(bundle.snapshot.items[0]).toMatchObject({ clientName: "Beta LLC", normalizedStatus: "stuck" });
  });

  it("falls back to the newest option for a month value not in the server-discovered allowlist", async () => {
    const source = new FakeSource({ sourceMonth: "PODCAST AUGUST 2026", rows: [HEADER] }, monthOptions);
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth("2099-01");

    expect(source.fetchPodcastTabCalls).toEqual(["PODCAST AUGUST 2026"]);
    expect(bundle.selectedMonth).toBe("2026-08");
  });

  it("falls back to the newest option for a null/missing month value", async () => {
    const source = new FakeSource({ sourceMonth: "PODCAST AUGUST 2026", rows: [HEADER] }, monthOptions);
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth(null);

    expect(bundle.selectedMonth).toBe("2026-08");
  });

  it("falls back to fetchLatestPodcastTab, with a null selectedMonth, when the workbook has no dated tab at all", async () => {
    const source = new FakeSource({ sourceMonth: "PODCAST DEPARTMENT (MAY)", rows: [HEADER] }, []);
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth("2026-08");

    expect(source.fetchLatestCallCount).toBe(1);
    expect(source.fetchPodcastTabCalls).toEqual([]);
    expect(bundle.selectedMonth).toBeNull();
    expect(bundle.monthOptions).toEqual([]);
    expect(bundle.snapshot.sourceMonth).toBe("PODCAST DEPARTMENT (MAY)");
  });
});

describe("createPodcastWorkflowSource", () => {
  it("throws PodcastSourceUnavailableError, not a network call, when service-account config is absent", () => {
    // This test environment carries no GOOGLE_SHEETS_* variables — the same
    // "not configured" state a real deployment is in until an operator adds
    // service-account credentials, per this task's own instruction not to
    // invent any.
    expect(isGoogleSheetsSourceConfigured()).toBe(false);
    expect(() => createPodcastWorkflowSource()).toThrow(PodcastSourceUnavailableError);
  });
});

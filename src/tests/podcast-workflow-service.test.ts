import { describe, expect, it } from "vitest";
import { PodcastWorkflowService } from "../services/podcast-workflow-service";
import {
  PodcastSourceUnavailableError,
  type PodcastWorkflowSheet,
  type PodcastWorkflowSource,
} from "../lib/integrations/google-sheets-source";
import { createPodcastWorkflowSource } from "../lib/integrations/google-sheets-source";
import { isGoogleSheetsSourceConfigured } from "../lib/env/google-sheets-env";

class FakeSource implements PodcastWorkflowSource {
  constructor(private readonly sheet: PodcastWorkflowSheet | (() => Promise<PodcastWorkflowSheet>)) {}
  async fetchLatestPodcastTab(): Promise<PodcastWorkflowSheet> {
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

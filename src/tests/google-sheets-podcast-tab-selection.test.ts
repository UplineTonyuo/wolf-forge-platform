import { describe, expect, it } from "vitest";
import { selectLatestPodcastTabTitle, type PodcastTabCandidate } from "../lib/integrations/google-sheets-source";

describe("selectLatestPodcastTabTitle", () => {
  it("picks the dated tab with the highest year and month, ignoring sheet index", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST DEPARTMENT (APRIL)", index: 0 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 1 },
      { title: "PODCAST DEPARTMENT (JUNE)", index: 2 },
      { title: "PODCAST JUNE 2024", index: 3 },
      { title: "PODCAST JULY 2026", index: 4 },
      { title: "PODCAST AUGUST 2026", index: 5 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST AUGUST 2026");
  });

  it("never lets an undated legacy title outrank a dated tab, even at a higher sheet index", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST AUGUST 2026", index: 0 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 10 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST AUGUST 2026");
  });

  it("does not simply pick the last array entry or the highest sheet index", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST AUGUST 2026", index: 0 },
      { title: "PODCAST JULY 2026", index: 99 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST AUGUST 2026");
  });

  it("prefers the higher year over a later month in a lower year", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST DECEMBER 2025", index: 0 },
      { title: "PODCAST JANUARY 2026", index: 1 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST JANUARY 2026");
  });

  it("falls back to sheet index among undated legacy tabs", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST DEPARTMENT (APRIL)", index: 0 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 1 },
      { title: "PODCAST DEPARTMENT (JUNE)", index: 2 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST DEPARTMENT (JUNE)");
  });

  it("ignores tabs that do not start with the PODCAST prefix", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PARTNER NOTES AUGUST 2026", index: 0 },
      { title: "PODCAST JULY 2026", index: 1 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("PODCAST JULY 2026");
  });

  it("returns null when no candidate matches the prefix", () => {
    const candidates: PodcastTabCandidate[] = [{ title: "GENERAL NOTES", index: 0 }];

    expect(selectLatestPodcastTabTitle(candidates)).toBeNull();
  });

  it("is case-insensitive on both the prefix and month names", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "podcast august 2026", index: 0 },
      { title: "Podcast July 2026", index: 1 },
    ];

    expect(selectLatestPodcastTabTitle(candidates)).toBe("podcast august 2026");
  });
});

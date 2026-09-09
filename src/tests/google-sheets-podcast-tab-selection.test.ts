import { describe, expect, it } from "vitest";
import {
  buildPodcastMonthOptions,
  resolvePodcastMonthSelection,
  selectLatestPodcastTabTitle,
  type PodcastMonthOption,
  type PodcastTabCandidate,
} from "../lib/integrations/google-sheets-source";

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

describe("buildPodcastMonthOptions", () => {
  it("lists only dated PODCAST tabs, newest first, as YYYY-MM values with human labels", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST JUNE 2026", index: 0 },
      { title: "PODCAST AUGUST 2026", index: 1 },
      { title: "PODCAST JULY 2026", index: 2 },
    ];

    expect(buildPodcastMonthOptions(candidates)).toEqual([
      { value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" },
      { value: "2026-07", label: "July 2026", tabTitle: "PODCAST JULY 2026" },
      { value: "2026-06", label: "June 2026", tabTitle: "PODCAST JUNE 2026" },
    ]);
  });

  it("orders across year boundaries correctly, not lexicographically by title", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST DECEMBER 2025", index: 0 },
      { title: "PODCAST JANUARY 2026", index: 1 },
    ];

    expect(buildPodcastMonthOptions(candidates).map((option) => option.value)).toEqual(["2026-01", "2025-12"]);
  });

  it("excludes undated legacy tabs from the selectable option list", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST AUGUST 2026", index: 0 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 1 },
    ];

    expect(buildPodcastMonthOptions(candidates)).toEqual([
      { value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" },
    ]);
  });

  it("ignores tabs that do not match the prefix", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PARTNER NOTES AUGUST 2026", index: 0 },
      { title: "PODCAST JULY 2026", index: 1 },
    ];

    expect(buildPodcastMonthOptions(candidates)).toEqual([
      { value: "2026-07", label: "July 2026", tabTitle: "PODCAST JULY 2026" },
    ]);
  });

  it("returns an empty list, never throwing, for a workbook with no dated Podcast tab", () => {
    expect(buildPodcastMonthOptions([{ title: "PODCAST DEPARTMENT (MAY)", index: 0 }])).toEqual([]);
  });

  it("collapses a duplicate month across two tabs to the one selectLatestPodcastTabTitle's own comparator would pick", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST AUGUST 2026", index: 0 },
      { title: "PODCAST AUGUST 2026 (copy)", index: 1 },
    ];

    const options = buildPodcastMonthOptions(candidates);
    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("2026-08");
  });

  it("recognizes a bare \"MONTH YYYY\" title with no PODCAST prefix at all", () => {
    expect(buildPodcastMonthOptions([{ title: "SEPTEMBER 2026", index: 0 }])).toEqual([
      { value: "2026-09", label: "September 2026", tabTitle: "SEPTEMBER 2026" },
    ]);
  });

  it("is case-insensitive on a bare month/year title", () => {
    expect(buildPodcastMonthOptions([{ title: "september 2026", index: 0 }])).toEqual([
      { value: "2026-09", label: "September 2026", tabTitle: "september 2026" },
    ]);
  });

  it("tolerates surrounding whitespace on a bare month/year title", () => {
    expect(buildPodcastMonthOptions([{ title: "  September 2026  ", index: 0 }])).toEqual([
      { value: "2026-09", label: "September 2026", tabTitle: "  September 2026  " },
    ]);
  });

  it("discovers the exact newest-first order for a mix of prefixed and bare monthly tabs, excluding unrelated tabs", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST JUNE 2024", index: 0 },
      { title: "PODCAST JULY 2026", index: 1 },
      { title: "PODCAST AUGUST 2026", index: 2 },
      { title: "SEPTEMBER 2026", index: 3 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 4 },
      { title: "Some Other Sheet", index: 5 },
    ];

    const options = buildPodcastMonthOptions(candidates);

    expect(options.map((option) => option.label)).toEqual([
      "September 2026",
      "August 2026",
      "July 2026",
      "June 2024",
    ]);
    expect(options.map((option) => option.tabTitle)).not.toContain("PODCAST DEPARTMENT (MAY)");
    expect(options.map((option) => option.tabTitle)).not.toContain("Some Other Sheet");
  });

  it("does not recognize a bare title with extra words around the month/year (not the whole title)", () => {
    expect(buildPodcastMonthOptions([{ title: "PODCAST DEPARTMENT SEPTEMBER 2026 DRAFT", index: 0 }])).toEqual([
      // Still recognized via the PREFIXED rule (starts with PODCAST, has year+month) —
      // this asserts the BARE rule specifically does not double- or mis-match it.
      { value: "2026-09", label: "September 2026", tabTitle: "PODCAST DEPARTMENT SEPTEMBER 2026 DRAFT" },
    ]);
  });

  it("does not recognize a bare title missing a 4-digit year, or one with extra trailing text", () => {
    expect(buildPodcastMonthOptions([{ title: "September", index: 0 }])).toEqual([]);
    expect(buildPodcastMonthOptions([{ title: "September 26", index: 0 }])).toEqual([]);
    expect(buildPodcastMonthOptions([{ title: "September 2026 Notes", index: 0 }])).toEqual([]);
  });

  it("excludes legacy no-year PODCAST DEPARTMENT (...) tabs even alongside bare dated tabs", () => {
    const candidates: PodcastTabCandidate[] = [
      { title: "PODCAST DEPARTMENT (APRIL)", index: 0 },
      { title: "PODCAST DEPARTMENT (MAY)", index: 1 },
      { title: "SEPTEMBER 2026", index: 2 },
    ];

    expect(buildPodcastMonthOptions(candidates)).toEqual([
      { value: "2026-09", label: "September 2026", tabTitle: "SEPTEMBER 2026" },
    ]);
  });
});

describe("resolvePodcastMonthSelection", () => {
  const options: PodcastMonthOption[] = [
    { value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" },
    { value: "2026-07", label: "July 2026", tabTitle: "PODCAST JULY 2026" },
  ];

  it("returns the exact match for a value present in the allowlist", () => {
    expect(resolvePodcastMonthSelection(options, "2026-07")).toEqual(options[1]);
  });

  it("falls back to the newest option for a value outside the allowlist", () => {
    expect(resolvePodcastMonthSelection(options, "2099-12")).toEqual(options[0]);
  });

  it("falls back to the newest option for null", () => {
    expect(resolvePodcastMonthSelection(options, null)).toEqual(options[0]);
  });

  it("falls back to the newest option for an empty string", () => {
    expect(resolvePodcastMonthSelection(options, "")).toEqual(options[0]);
  });

  it("returns null only when there are no options to fall back to at all", () => {
    expect(resolvePodcastMonthSelection([], "2026-08")).toBeNull();
  });
});

describe("buildPodcastMonthOptions + resolvePodcastMonthSelection — end-to-end discovery scenario", () => {
  const CANDIDATES: PodcastTabCandidate[] = [
    { title: "PODCAST JUNE 2024", index: 0 },
    { title: "PODCAST JULY 2026", index: 1 },
    { title: "PODCAST AUGUST 2026", index: 2 },
    { title: "SEPTEMBER 2026", index: 3 },
    { title: "PODCAST DEPARTMENT (MAY)", index: 4 },
    { title: "Some Other Sheet", index: 5 },
  ];

  it("defaults to the newest month (the bare SEPTEMBER 2026 tab) with no requested month", () => {
    const options = buildPodcastMonthOptions(CANDIDATES);
    const resolved = resolvePodcastMonthSelection(options, null);
    expect(resolved).toEqual({ value: "2026-09", label: "September 2026", tabTitle: "SEPTEMBER 2026" });
  });

  it("resolves ?month=2026-08 to the prefixed August tab", () => {
    const options = buildPodcastMonthOptions(CANDIDATES);
    const resolved = resolvePodcastMonthSelection(options, "2026-08");
    expect(resolved).toEqual({ value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" });
  });

  it("falls back to the newest bare-tab month for an invalid/unrecognized ?month=", () => {
    const options = buildPodcastMonthOptions(CANDIDATES);
    const resolved = resolvePodcastMonthSelection(options, "not-a-real-month");
    expect(resolved?.value).toBe("2026-09");
  });

  it("every resolved tabTitle traces back to a title this same discovery pass actually read — never an invented or client-supplied one", () => {
    const options = buildPodcastMonthOptions(CANDIDATES);
    const discoveredTitles = new Set(CANDIDATES.map((candidate) => candidate.title));
    for (const requested of [null, "2026-08", "2026-07", "2024-06", "garbage", "2026-13"]) {
      const resolved = resolvePodcastMonthSelection(options, requested);
      expect(resolved).not.toBeNull();
      expect(discoveredTitles.has(resolved!.tabTitle)).toBe(true);
    }
  });
});

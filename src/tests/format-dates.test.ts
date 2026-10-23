import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Set TZ before Node starts: changing it inside a Vitest worker is platform-dependent.
function formatInTimezone(timeZone: string) {
  const source = `
    import { formatDate, formatShortDate, formatDateTime } from ${JSON.stringify(new URL("../lib/format.ts", import.meta.url).href)};
    const dates = ["2026-08-20", "2026-01-01", "2024-02-29", "2026-03-08", "2026-11-01", "0099-08-20"];
    const timestamps = ["2026-08-20T00:00:00Z", "2026-08-20T00:00:00+08:00", "2026-08-20T00:00:00-07:00", "2026-08-20T00:00:00"];
    console.log(JSON.stringify({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dates: dates.map(value => [formatDate(value), formatShortDate(value)]),
      empty: [formatDate(null), formatDate(""), formatShortDate(null), formatShortDate("")],
      timestamps: timestamps.map(value => ({
        date: formatDate(value), short: formatShortDate(value), datetime: formatDateTime(value),
        expectedDate: new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)),
        expectedShort: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value)),
        expectedDatetime: new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)),
      })),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    env: { ...process.env, TZ: timeZone }, encoding: "utf8", timeout: 15_000,
  })) as {
    timeZone: string;
    dates: string[][];
    empty: string[];
    timestamps: { date: string; short: string; datetime: string; expectedDate: string; expectedShort: string; expectedDatetime: string }[];
  };
}

describe.each(["America/Los_Angeles", "Asia/Manila", "UTC"])("date formatting in %s", (timeZone) => {
  it("preserves calendar dates and existing local timestamp formatting", () => {
    const result = formatInTimezone(timeZone);
    expect(result.timeZone).toBe(timeZone);
    expect(result.dates).toEqual([
      ["Aug 20, 2026", "Aug 20"], ["Jan 1, 2026", "Jan 1"],
      ["Feb 29, 2024", "Feb 29"], ["Mar 8, 2026", "Mar 8"],
      ["Nov 1, 2026", "Nov 1"], ["Aug 20, 99", "Aug 20"],
    ]);
    expect(result.empty).toEqual(Array(4).fill("Not set"));
    for (const value of result.timestamps) {
      expect(value.date).toBe(value.expectedDate);
      expect(value.short).toBe(value.expectedShort);
      expect(value.datetime).toBe(value.expectedDatetime);
    }
    expect(result.timestamps[0]!.date).toBe(timeZone === "America/Los_Angeles" ? "Aug 19, 2026" : "Aug 20, 2026");
  });
});

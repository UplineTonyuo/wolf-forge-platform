import { describe, expect, it } from "vitest";
import { formatCleanDomain, formatFreshness } from "../lib/format";

describe("formatCleanDomain", () => {
  it("strips protocol, www, and trailing slash", () => {
    expect(formatCleanDomain("https://seeitgonejunkremoval.com/")).toBe("seeitgonejunkremoval.com");
    expect(formatCleanDomain("http://www.example.com/")).toBe("example.com");
  });

  it("strips a path such as /wp-admin", () => {
    expect(formatCleanDomain("https://junkbytuckllc.com/wp-admin")).toBe("junkbytuckllc.com");
  });

  it("strips query strings and hashes along with the path", () => {
    expect(formatCleanDomain("https://example.com/path?ref=abc#section")).toBe("example.com");
  });

  it("falls back to the original value when it isn't a URL", () => {
    expect(formatCleanDomain("Acme Co")).toBe("Acme Co");
    expect(formatCleanDomain("")).toBe("");
  });

  it("falls back to the original value for a non-http(s) scheme", () => {
    expect(formatCleanDomain("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("formatFreshness", () => {
  const now = new Date("2026-08-29T12:00:00.000Z").getTime();

  it("reports 'just now' for anything under a minute old", () => {
    expect(formatFreshness(new Date(now - 10_000).toISOString(), now)).toBe("Updated just now");
    expect(formatFreshness(new Date(now).toISOString(), now)).toBe("Updated just now");
  });

  it("reports whole minutes once past a minute", () => {
    expect(formatFreshness(new Date(now - 90_000).toISOString(), now)).toBe("Updated 1m ago");
    expect(formatFreshness(new Date(now - 5 * 60_000).toISOString(), now)).toBe("Updated 5m ago");
  });

  it("reports whole hours once past an hour", () => {
    expect(formatFreshness(new Date(now - 2 * 60 * 60_000).toISOString(), now)).toBe("Updated 2h ago");
  });

  it("falls back to a date once past a day", () => {
    const dayOld = new Date(now - 2 * 24 * 60 * 60_000).toISOString();
    expect(formatFreshness(dayOld, now)).toMatch(/^Updated [A-Z][a-z]{2} \d{1,2}$/);
  });

  it("reports not-yet-synced for a null or invalid timestamp", () => {
    expect(formatFreshness(null, now)).toBe("Not yet synced");
    expect(formatFreshness("not a date", now)).toBe("Not yet synced");
  });
});

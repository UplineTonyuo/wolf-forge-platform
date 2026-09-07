import { describe, expect, it } from "vitest";
import {
  normalizeRoutePathname,
  sanitizeSpeedInsightsEvent,
  type SpeedInsightsBeforeSendEvent,
} from "../domain/observability/speed-insights-privacy";

function event(url: string, route?: string): SpeedInsightsBeforeSendEvent {
  return route === undefined ? { type: "vital", url } : { type: "vital", url, route };
}

describe("Speed Insights privacy sanitizer", () => {
  it("strips a private search query entirely", () => {
    const result = sanitizeSpeedInsightsEvent(
      event("https://wolf-forge-platform-woad.vercel.app/clients?q=private-search"),
    );
    expect(result?.url).toBe("https://wolf-forge-platform-woad.vercel.app/clients");
    expect(result?.url).not.toContain("private-search");
    expect(result?.url).not.toContain("q=");
  });

  it("strips Team UI query state", () => {
    const result = sanitizeSpeedInsightsEvent(event("https://app.example.com/team?team-messages=open&thread=abc"));
    expect(result?.url).toBe("https://app.example.com/team");
    expect(result?.url).not.toContain("team-messages");
    expect(result?.url).not.toContain("thread");
  });

  it("strips an auth redirect parameter", () => {
    const result = sanitizeSpeedInsightsEvent(event("https://app.example.com/login?next=/clients/abc-123"));
    expect(result?.url).toBe("https://app.example.com/login");
    expect(result?.url).not.toContain("next=");
    expect(result?.url).not.toContain("abc-123");
  });

  it("strips a URL fragment", () => {
    const result = sanitizeSpeedInsightsEvent(event("https://app.example.com/reporting#section-2"));
    expect(result?.url).toBe("https://app.example.com/reporting");
    expect(result?.url).not.toContain("#");
  });

  it("preserves a safe static route unchanged", () => {
    for (const path of [
      "/dashboard",
      "/team",
      "/settings",
      "/account",
      "/account/store",
      "/todo",
      "/todo/departments",
      "/todo/departments/content",
      "/todo/departments/podcast-seo",
    ]) {
      expect(normalizeRoutePathname(path)).toBe(path);
    }
  });

  it("normalizes Operations and Team Voice API routes without leaking identifiers", () => {
    expect(normalizeRoutePathname("/api/operations/podcast-seo/snapshot")).toBe(
      "/api/operations/podcast-seo/snapshot",
    );
    expect(normalizeRoutePathname("/api/team-voice/playback")).toBe("/api/team-voice/playback");
    expect(normalizeRoutePathname("/api/internal/team-voice-cleanup")).toBe(
      "/api/internal/team-voice-cleanup",
    );
    expect(
      sanitizeSpeedInsightsEvent(
        event("https://app.example.com/api/team-voice/playback?messageId=9f1c2e3a-52b1-4e2a-9d3a-000000000001"),
      )?.url,
    ).toBe("https://app.example.com/api/team-voice/playback");
  });

  it("normalizes a known dynamic record route to its template, dropping the real id", () => {
    const result = sanitizeSpeedInsightsEvent(
      event("https://app.example.com/clients/9f1c2e3a-52b1-4e2a-9d3a-000000000001"),
    );
    expect(result?.url).toBe("https://app.example.com/clients/[companyId]");
    expect(result?.url).not.toContain("9f1c2e3a");

    expect(normalizeRoutePathname("/orders/9f1c2e3a-52b1-4e2a-9d3a-000000000002/edit")).toBe(
      "/orders/[orderId]/edit",
    );
    expect(normalizeRoutePathname("/f/some-canonical-form-key")).toBe("/f/[canonicalKey]");
  });

  it("fails closed on an unrecognized or unknown-shaped route rather than transmitting it", () => {
    expect(normalizeRoutePathname("/clients/abc/extra/unexpected/segments")).toBeNull();
    expect(normalizeRoutePathname("/totally-unknown-route")).toBeNull();
    expect(sanitizeSpeedInsightsEvent(event("https://app.example.com/not-a-real-route/123"))).toBeNull();
  });

  it("keeps origin/protocol handling valid for both absolute and relative urls", () => {
    expect(sanitizeSpeedInsightsEvent(event("https://app.example.com/dashboard"))?.url).toBe(
      "https://app.example.com/dashboard",
    );
    expect(sanitizeSpeedInsightsEvent(event("/dashboard"))?.url).toBe("/dashboard");
  });

  it("never throws on malformed or unexpected input", () => {
    const malformedInputs = [
      "",
      "not a url at all",
      "https://",
      "%%%invalid-percent-encoding%%%",
      "http://[invalid-host",
      "javascript:alert(1)",
    ];
    for (const raw of malformedInputs) {
      expect(() => sanitizeSpeedInsightsEvent(event(raw))).not.toThrow();
    }
    // @ts-expect-error — deliberately exercising non-string/garbage input paths.
    expect(() => sanitizeSpeedInsightsEvent(event(undefined))).not.toThrow();
  });

  it("fails closed on an empty or whitespace-only url instead of defaulting to the home route", () => {
    expect(sanitizeSpeedInsightsEvent(event(""))).toBeNull();
    expect(sanitizeSpeedInsightsEvent(event("   "))).toBeNull();
  });

  it("fails closed on a doubled slash instead of collapsing it into a shorter known route", () => {
    expect(normalizeRoutePathname("/clients//9f1c2e3a-52b1-4e2a-9d3a-000000000001")).toBeNull();
    expect(normalizeRoutePathname("//dashboard")).toBeNull();
    expect(normalizeRoutePathname("/dashboard//")).toBeNull();
  });

  it("fails closed on a malformed percent escape inside a dynamic route segment", () => {
    // %ZZ has no valid hex digits after the escape character at all.
    expect(normalizeRoutePathname("/clients/%ZZ")).toBeNull();
    expect(
      sanitizeSpeedInsightsEvent(event("https://app.example.com/clients/%ZZ")),
    ).toBeNull();
  });

  it("fails closed on an incomplete percent escape", () => {
    // %2 is missing its second hex digit.
    expect(normalizeRoutePathname("/clients/%2")).toBeNull();
    expect(normalizeRoutePathname("/orders/%2/edit")).toBeNull();
  });

  it("fails closed on a percent sequence that is not valid UTF-8", () => {
    // %E0%A4%A is a truncated three-byte sequence — decodeURIComponent
    // enforces real UTF-8 well-formedness, not merely hex-digit shape, so
    // this throws even though every individual %XX pair looks superficially
    // well-formed.
    expect(normalizeRoutePathname("/orders/%E0%A4%A/edit")).toBeNull();
    // %C0%80 is a structurally valid but overlong (non-canonical) encoding,
    // also rejected by decodeURIComponent.
    expect(normalizeRoutePathname("/clients/%C0%80")).toBeNull();
    // %ED%A0%80 decodes to an unpaired UTF-16 surrogate, also invalid.
    expect(normalizeRoutePathname("/clients/%ED%A0%80")).toBeNull();
  });

  it("still normalizes a well-formed percent-encoded static route", () => {
    // "das%68board" decodes to the literal string "dashboard" and must
    // still match the static "dashboard" pattern exactly.
    expect(normalizeRoutePathname("/das%68board")).toBe("/dashboard");
  });

  it("still normalizes a well-formed percent-encoded dynamic route to its template", () => {
    // A dynamic segment's decoded value is never inspected or returned —
    // only that it decodes validly at all and sits in the right position.
    const result = normalizeRoutePathname("/clients/%E2%9C%93-checkmark-id");
    expect(result).toBe("/clients/[companyId]");
    expect(result).not.toContain("%E2");
    expect(result).not.toContain("checkmark");
  });

  it("normalizes a single trailing slash safely on both static and dynamic routes", () => {
    // A single trailing slash produces exactly one empty segment, which the
    // existing filter drops the same way it drops the path's own leading
    // empty segment — deterministic, and not the ambiguous case the
    // doubled-slash guard exists for.
    expect(normalizeRoutePathname("/dashboard/")).toBe("/dashboard");
    expect(normalizeRoutePathname("/clients/")).toBe("/clients");
    expect(
      normalizeRoutePathname("/clients/9f1c2e3a-52b1-4e2a-9d3a-000000000001/"),
    ).toBe("/clients/[companyId]");
  });

  it("fails closed on an arbitrary malformed url end to end through the public sanitizer", () => {
    expect(sanitizeSpeedInsightsEvent(event("%%%invalid-percent-encoding%%%"))).toBeNull();
  });

  it("never returns a vendor-supplied route field verbatim without normalizing it", () => {
    const result = sanitizeSpeedInsightsEvent(
      event("https://app.example.com/clients/9f1c2e3a-52b1-4e2a-9d3a-000000000001", "/clients/9f1c2e3a-raw"),
    );
    expect(result?.route).toBe("/clients/[companyId]");
    expect(result?.route).not.toContain("9f1c2e3a");
  });
});

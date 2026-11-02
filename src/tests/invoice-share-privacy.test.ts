import { afterEach, describe, expect, it, vi } from "vitest";
import { redactInvoiceSharePath, sanitizeInvoiceShareTelemetry } from "../domain/observability/invoice-share-privacy";
import { redactString } from "../domain/security/redaction";
import { sanitizeSpeedInsightsEvent } from "../domain/observability/speed-insights-privacy";
import { securityHeaderRules } from "../lib/security/response-headers";

const token = "ab123456789cd".repeat(5).slice(0, 64);
const path = `/share/invoices/${token}`;
const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init, captureRouterTransitionStart: vi.fn() }));
vi.mock("botid/client/core", () => ({ initBotId: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public invoice capability privacy", () => {
  it.each([path, `https://example.invalid${path}?copy=${token}#${token}`, `GET ${path} HTTP/1.1`, encodeURIComponent(path), "/share/invoices/invalid-input"])("masks every share path, including malformed capabilities and query/hash tails", (value) => {
    const result = redactInvoiceSharePath(value);
    expect(result).not.toContain(token);
    expect(result).not.toContain("invalid-input");
    expect(result).toContain("/share/invoices/[token]");
  });
  it("does not rewrite unrelated diagnostics", () => {
    expect(redactInvoiceSharePath("GET /account/invoices/abc/payment")).toBe("GET /account/invoices/abc/payment");
  });
  it("scrubs standalone route and RPC token attributes", () => {
    expect(sanitizeInvoiceShareTelemetry({params:{token},data:{p_token:token}})).toEqual({params:{token:"[redacted]"},data:{p_token:"[redacted]"}});
  });
  it("scrubs security diagnostics before generic digit redaction can split the token", () => {
    expect(redactString(`GET https://example.invalid${path}`)).toBe("GET https://example.invalid/share/invoices/[token]");
  });
  it("scrubs nested error, request, span and navigation fields without mutating the original event", () => {
    const event = { request: { url: `https://example.invalid${path}` }, exception: { values: [{ value: `failed GET ${path}`, stacktrace: { frames: [{ filename: path }] } }] }, spans: [{ description: `GET ${path}`, data: { "url.full": path } }], breadcrumbs: [{ category: "navigation", data: { from: "/invoices", to: path } }], transaction: path, contexts: { trace: { trace_id: "trace-safe", data: { url: path } } } };
    const result = sanitizeInvoiceShareTelemetry(event);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.contexts.trace.trace_id).toBe("trace-safe");
    expect(event.request.url).toContain(token);
  });
  it("preserves repeated references and terminates on cyclic SDK context", () => {
    const event: { url: string; context?: unknown } = { url: path }; event.context = event;
    const result = sanitizeInvoiceShareTelemetry(event);
    expect(result.url).toBe("/share/invoices/[token]");
    expect(result.context).toBe(result);
  });
  it("unknown share routes stay excluded from Speed Insights", () => {
    expect(sanitizeSpeedInsightsEvent({ type: "vital", url: `https://example.invalid${path}` })).toBeNull();
  });
  it("central share headers override global referrers and disallow indexing/cache", () => {
    const rules = securityHeaderRules({ isProduction: true });
    const general = rules.find((rule) => rule.source === "/:path*");
    const share = rules.find((rule) => rule.source === "/share/invoices/:path*");
    expect(rules.indexOf(share!)).toBeGreaterThan(rules.indexOf(general!));
    const headers = Object.fromEntries(share!.headers.map((header) => [header.key, header.value]));
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["CDN-Cache-Control"]).toBe("no-store");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("no-store");
    expect(headers["X-Robots-Tag"]).toMatch(/noindex.*nofollow/);
    expect(general?.headers.find((header) => header.key === "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
  });
  it.each(["browser", "node", "edge"])("%s Sentry hooks scrub streamed spans as well as errors and breadcrumbs", async (runtime) => {
    vi.resetModules(); init.mockClear();
    vi.stubGlobal("window", { location: { pathname: path } });
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENABLED", "1");
    if (runtime === "browser") await import("../instrumentation-client");
    if (runtime === "node") await import("../../sentry.server.config");
    if (runtime === "edge") await import("../../sentry.edge.config");
    const options = init.mock.calls[0]?.[0];
    if (runtime === "browser") expect(options.enabled).toBe(false);
    for (const hook of ["beforeSend", "beforeSendSpan", "beforeBreadcrumb"]) {
      const result = options[hook]({ request: { url: path }, data: { "url.full": path }, message: path });
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_VERIFIER_COOKIE } from "../lib/integrations/oauth-state";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), environment: vi.fn(), service: vi.fn(), authorizationUrl: vi.fn(),
  capabilityDenied: vi.fn(), originRejected: vi.fn(), event: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
vi.mock("../lib/env/google-oauth-env", () => ({ readGoogleOAuthEnvironment: mocks.environment }));
vi.mock("../lib/integrations/gmail-server", () => ({ createGmailIntegrationService: mocks.service }));
vi.mock("../lib/integrations/gmail-observability", () => ({
  recordGmailCapabilityDenied: mocks.capabilityDenied,
  recordGmailOriginRejected: mocks.originRejected,
  recordGmailRouteEvent: mocks.event,
}));

import { POST } from "../app/(internal)/settings/integrations/gmail/connect/route";

const origin = "https://wolf-forge.test";
const callbackPath = "/settings/integrations/gmail/callback";
const actor = { id: "10000000-0000-4000-8000-000000000001" };

function request(accept = "text/html", requestOrigin: string | null = origin) {
  const headers = new Headers({ accept });
  if (requestOrigin !== null) headers.set("origin", requestOrigin);
  return new NextRequest(`${origin}/settings/integrations/gmail/connect`, { method: "POST", headers });
}

function expectNoAuthorizationPreparation(response: NextResponse) {
  expect(response.cookies.getAll()).toEqual([]);
  expect(response.headers.has("location")).toBe(false);
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.authorizationUrl).not.toHaveBeenCalled();
  expect(mocks.event.mock.calls.some(([input]) => [
    "integration.gmail.connect_started", "integration.gmail.authorization_ready",
  ].includes(input.event))).toBe(false);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ actor, user: { integrations: { manage: true } } });
  mocks.environment.mockReturnValue({ GOOGLE_OAUTH_REDIRECT_URI: `${origin}${callbackPath}` });
  mocks.service.mockReturnValue({ authorizationUrl: mocks.authorizationUrl });
  mocks.authorizationUrl.mockImplementation((state: string, challenge: string) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return url;
  });
  mocks.capabilityDenied.mockResolvedValue(undefined);
  mocks.originRejected.mockResolvedValue(undefined);
  mocks.event.mockResolvedValue(undefined);
});

describe("Gmail connect route authorization preparation", () => {
  it.each([
    { mode: "JSON", accept: "application/json", status: 200 },
    { mode: "native form", accept: "text/html", status: 303 },
  ])("returns private no-store $mode preparation with real state and PKCE cookies", async ({ accept, status }) => {
    const response = await POST(request(accept));
    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const state = response.cookies.get(GMAIL_OAUTH_STATE_COOKIE)!;
    const verifier = response.cookies.get(GMAIL_OAUTH_VERIFIER_COOKIE)!;
    expect(response.cookies.getAll()).toHaveLength(2);
    expect(state.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier.value).toMatch(/^[A-Za-z0-9_-]{86}$/);
    for (const cookie of [state, verifier]) {
      expect(cookie).toMatchObject({ path: callbackPath, httpOnly: true, sameSite: "lax", secure: true, maxAge: 600 });
      expect(cookie.domain).toBeUndefined();
    }
    const serializedCookies = response.headers.getSetCookie();
    expect(serializedCookies).toHaveLength(2);
    for (const cookie of serializedCookies) {
      expect(cookie).toContain(`Path=${callbackPath}`);
      expect(cookie).toContain("Max-Age=600");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=lax");
      expect(cookie).not.toContain("Domain=");
    }

    const challenge = createHash("sha256").update(verifier.value).digest("base64url");
    expect(mocks.service).toHaveBeenCalledExactlyOnceWith(actor);
    expect(mocks.authorizationUrl).toHaveBeenCalledExactlyOnceWith(state.value, challenge);
    const url = mocks.authorizationUrl.mock.results[0]!.value as URL;
    expect(url.searchParams.get("state")).toBe(state.value);
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    if (accept === "application/json") {
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.has("location")).toBe(false);
      expect(await response.json()).toEqual({ authorizationUrl: url.href });
    } else {
      expect(response.headers.get("location")).toBe(url.href);
      expect(await response.text()).toBe("");
    }

    expect(mocks.event.mock.calls.map(([payload]) => payload)).toEqual([
      { event: "integration.gmail.connect_started", action: "connect", reason: "authorization_preparation_started", actorId: actor.id, outcome: "succeeded" },
      { event: "integration.gmail.authorization_ready", action: "connect", reason: "authorization_url_prepared", actorId: actor.id, outcome: "succeeded" },
    ]);
    const logged = JSON.stringify(mocks.event.mock.calls);
    for (const sensitive of [state.value, verifier.value, challenge, url.href, url.origin]) expect(logged).not.toContain(sensitive);
    expect(mocks.capabilityDenied).not.toHaveBeenCalled();
    expect(mocks.originRejected).not.toHaveBeenCalled();
  });

  it("generates fresh state and verifier values for a new explicit preparation", async () => {
    const first = await POST(request("application/json"));
    const second = await POST(request("application/json"));
    for (const name of [GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_VERIFIER_COOKIE]) {
      expect(second.cookies.get(name)!.value).not.toBe(first.cookies.get(name)!.value);
    }
  });

  it("retains the manager denial before configuration or authorization preparation", async () => {
    mocks.context.mockResolvedValue({ actor, user: { integrations: { manage: false } } });
    const response = await POST(request("application/json"));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(mocks.capabilityDenied).toHaveBeenCalledExactlyOnceWith({ action: "connect", actorId: actor.id });
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.originRejected).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expectNoAuthorizationPreparation(response);
  });

  it("retains the missing-configuration response without logging preparation stages", async () => {
    mocks.environment.mockImplementation(() => { throw new Error("Synthetic unavailable configuration"); });
    const response = await POST(request("application/json"));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Gmail OAuth is not configured.");
    expect(mocks.event.mock.calls.map(([payload]) => payload)).toEqual([
      { event: "integration.gmail.not_configured", action: "connect", reason: "oauth_environment_missing", actorId: actor.id },
    ]);
    expect(mocks.capabilityDenied).not.toHaveBeenCalled();
    expect(mocks.originRejected).not.toHaveBeenCalled();
    expectNoAuthorizationPreparation(response);
  });

  it.each([null, "https://foreign.test", "not-an-origin"])("retains origin rejection for %s without preparation", async (requestOrigin) => {
    const response = await POST(request("application/json", requestOrigin));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Invalid request origin.");
    expect(mocks.originRejected).toHaveBeenCalledExactlyOnceWith({ action: "connect", actorId: actor.id });
    expect(mocks.capabilityDenied).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expectNoAuthorizationPreparation(response);
  });

  it("preserves the native authentication redirect instead of converting it to JSON preparation", async () => {
    let authRedirect: unknown;
    try { redirect("/login"); } catch (error) { authRedirect = error; }
    expect(authRedirect).toBeInstanceOf(Error);
    mocks.context.mockRejectedValue(authRedirect);
    await expect(POST(request("application/json"))).rejects.toBe(authRedirect);
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.capabilityDenied).not.toHaveBeenCalled();
    expect(mocks.originRejected).not.toHaveBeenCalled();
  });
});

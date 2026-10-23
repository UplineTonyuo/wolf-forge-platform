import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TENANT_SELECTOR_HEADER, toTenantSelector } from "../domain/tenancy/tenant-selector";
import { createUserSupabaseClient } from "../lib/supabase/user-client";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: {} } }) } }),
}));

const environment = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "local-key" };
const wolfForge = "f0f0f0f0-0000-4000-8000-000000000001";

async function outboundHeaders(tenantSelector?: ReturnType<typeof toTenantSelector>) {
  const fetchMock = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  await createUserSupabaseClient(environment, "signed-token", tenantSelector).rpc("app_current_user_permissions");
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return new Headers(init.headers);
}

afterEach(() => vi.unstubAllGlobals());

describe("tenant selector", () => {
  it("accepts only UUIDs and normalises case", () => {
    expect(toTenantSelector(wolfForge.toUpperCase())).toBe(wolfForge);
    for (const bad of ["", "wolf-forge", `${wolfForge}, ${wolfForge}`, ` ${wolfForge}`]) {
      expect(() => toTenantSelector(bad)).toThrow("UUID");
    }
  });

  it("is sent as x-wf-tenant alongside the unchanged bearer token", async () => {
    const headers = await outboundHeaders(toTenantSelector(wolfForge));
    expect(headers.get(TENANT_SELECTOR_HEADER)).toBe(wolfForge);
    expect(headers.get("authorization")).toBe("Bearer signed-token");
  });

  it("is absent when no selector is supplied, as for every existing caller", async () => {
    const headers = await outboundHeaders();
    expect(headers.has(TENANT_SELECTOR_HEADER)).toBe(false);
    expect(headers.get("authorization")).toBe("Bearer signed-token");
  });

  it("a browser value is replaced by the proxy with the host's Tenant (WL-2.22b)", async () => {
    vi.stubEnv("SUPABASE_URL", environment.SUPABASE_URL);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY);
    const { proxy } = await import("../proxy");
    const forged = "f0f0f0f0-0000-4000-8000-000000002601";

    const response = await proxy(new NextRequest("http://localhost:3000/dashboard", {
      headers: { host: "localhost:3000", [TENANT_SELECTOR_HEADER]: forged, "x-other": "kept" },
    }));

    const forwarded = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
    expect(forwarded).toContain("x-other");
    expect(response.headers.get(`x-middleware-request-${TENANT_SELECTOR_HEADER}`)).toBe(wolfForge);
  });
});

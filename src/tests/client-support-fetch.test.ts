import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientSupportFetch } from "../lib/supabase/client-support-fetch";
import { CLIENT_SUPPORT_READ_TABLES, CLIENT_SUPPORT_RPCS } from "../domain/auth/client-support-operations";

const network = vi.fn(async () => new Response("{}"));
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => vi.unstubAllGlobals());
const delegated = () => clientSupportFetch("https://provider.example.invalid");

describe("delegated provider operation boundary", () => {
  it.each(CLIENT_SUPPORT_READ_TABLES)("permits scoped GET of %s", async (table) => {
    await delegated()(`https://provider.example.invalid/rest/v1/${table}?select=id`);
    expect(network).toHaveBeenCalledOnce();
  });
  it("permits only reviewed business RPC names without rewriting the bearer", async () => {
    const request = new Request(`https://provider.example.invalid/rest/v1/rpc/${CLIENT_SUPPORT_RPCS[0]}`, {
      method: "POST", headers: { Authorization: "Bearer original-administrator-token" },
    });
    await delegated()(request);
    expect(network).toHaveBeenCalledWith(request, undefined);
  });
  it.each([
    ["https://foreign.example.invalid/rest/v1/rpc/app_submit_form", "POST"],
    ["https://provider.example.invalid/storage/v1/object/private/file", "GET"],
    ["https://provider.example.invalid/auth/v1/logout", "POST"],
    ["https://provider.example.invalid/auth/v1/user", "PUT"],
    ["https://provider.example.invalid/rest/v1/rpc/app_update_my_profile", "POST"],
    ["https://provider.example.invalid/rest/v1/rpc/app_new_unreviewed_rpc", "POST"],
    ["https://provider.example.invalid/rest/v1/profiles", "PATCH"],
    ["https://provider.example.invalid/rest/v1/tenant_memberships", "GET"],
  ])("refuses unsupported %s %s before network", async (url, method) => {
    await expect(delegated()(url, { method })).rejects.toThrow("unavailable");
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["/auth/v1/user", "/auth/v1/.well-known/jwks.json"])("retains original Auth claim verification %s", async (path) => {
    await delegated()(`https://provider.example.invalid${path}`);
    expect(network).toHaveBeenCalledOnce();
  });
});

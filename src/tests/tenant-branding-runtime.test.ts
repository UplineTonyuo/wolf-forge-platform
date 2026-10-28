import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children } from "react";
import { GET } from "../app/api/white-label/runtime/route";
import InternalLayout from "../app/(internal)/layout";
import ClientAccountLayout from "../app/account/layout";
import { ClientDraftProvider } from "../components/tickets/client-draft-provider";
import { ClientAccountShell } from "../components/account/client-account-shell";
import { InternalShell } from "../components/shell/internal-shell";
import { IdentityLookupError } from "../lib/supabase/identity-lookup";

const state = vi.hoisted(() => ({
  session: vi.fn(), internal: vi.fn(), client: vi.fn(), identityFailure: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({
  getVerifiedSessionContext: state.session, getInternalContext: state.internal, getClientContext: state.client,
}));
vi.mock("../lib/supabase/identity-failure-response", () => ({ identityFailureResponse: state.identityFailure }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: async () => false, isLocalQuickAccessSession: async () => false }));
vi.mock("../lib/supabase/client-portal-data", () => ({ getClientNavCounts: async () => null }));
vi.mock("../components/shell/internal-shell", () => ({ InternalShell: () => null }));
vi.mock("../components/account/client-account-shell", () => ({ ClientAccountShell: () => null }));

const tenantId = "aaaaaaaa-0000-4000-8000-000000000001";
const published = { kind: "published", configuration: {
  tenantId, publicationRevision: 3, sourceDraftRevision: 5, displayName: "Published workspace",
  primaryColor: "#173c32", accentColor: "#d2b777", moduleKeys: ["services"], publishedAt: "2026-10-16T00:00:00Z",
} };
const rpc = vi.fn();
const context = {
  actor: { id: "actor-a" }, client: { rpc }, user: { id: "actor-a", tenantId, modules: {} },
  services: { profile: { getMine: async () => null } },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.session.mockResolvedValue(context);
  state.internal.mockResolvedValue(context);
  state.client.mockResolvedValue(context);
  rpc.mockResolvedValue({ data: published, error: null });
  state.identityFailure.mockImplementation(async (error: IdentityLookupError) => Response.json({ ok: false }, {
    status: error.kind === "unavailable" ? 503 : error.kind === "unauthorized" ? 403 : 401,
    headers: { "cache-control": "private, no-store, max-age=0" },
  }));
});

describe("runtime GET binding", () => {
  it("reacquires the verified session and reads only the authoritative no-argument runtime RPC", async () => {
    const first = await GET();
    expect(await first.json()).toEqual(published);
    expect(first.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(first.headers.get("x-wf-branding-actor")).toBe("actor-a");
    const nextRpc = vi.fn().mockResolvedValue({ data: { kind: "unpublished", tenantId, publicationRevision: 0 }, error: null });
    state.session.mockResolvedValue({ actor: { id: "actor-b" }, client: { rpc: nextRpc } });
    const next = await GET();
    expect(next.headers.get("x-wf-branding-actor")).toBe("actor-b");
    expect(state.session).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls).toEqual([["app_get_runtime_white_label_configuration"]]);
    expect(nextRpc.mock.calls).toEqual([["app_get_runtime_white_label_configuration"]]);
  });

  it.each([
    { kind: "unpublished", tenantId, publicationRevision: 0 },
    { kind: "legacy_modules", tenantId, publicationRevision: 4, moduleKeys: ["services"] },
  ])("preserves the exact $kind compatibility result", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
  });

  it("uses the established missing-session failure without invoking publication", async () => {
    state.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(state.identityFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "unauthenticated" }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "unauthenticated", "unauthorized"] as const)("delegates %s identity failure to Auth", async (kind) => {
    const error = new IdentityLookupError(kind, "claims");
    state.session.mockRejectedValueOnce(error);
    const response = await GET();
    expect(state.identityFailure).toHaveBeenCalledWith(error);
    expect(response.status).toBe(kind === "unavailable" ? 503 : kind === "unauthorized" ? 403 : 401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["42501", "P0002"])("returns explicit denial for %s, never a default publication", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "private-provider-detail" } });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "Access refused." });
  });

  it.each([null, { kind: "draft" }, { ...published, configuration: { ...published.configuration, primaryColor: "red" } }])("rejects malformed runtime payload %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Workspace branding is unavailable." });
  });

  it("redacts a transport exception", async () => {
    rpc.mockRejectedValueOnce(new Error("private-provider-detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-provider-detail");
  });
});

describe("layout published snapshot binding", () => {
  const layouts = [
    { name: "internal", render: async () => {
      const shell = await InternalLayout({ children: "business workspace" });
      expect(shell.type).toBe(InternalShell);
      return shell;
    } },
    { name: "client", render: async () => {
      const provider = await ClientAccountLayout({ children: "business workspace" });
      expect(provider.type).toBe(ClientDraftProvider);
      const shell = provider.props.children;
      expect(shell.type).toBe(ClientAccountShell);
      return shell;
    } },
  ];

  it.each(layouts)("seeds the actual $name shell from the authorized runtime read", async ({ render }) => {
    const shell = await render();
    expect(shell.props.runtimeConfiguration).toEqual(published);
    expect(Children.toArray(shell.props.children)).toEqual(["business workspace"]);
    expect(rpc.mock.calls).toEqual([["app_get_runtime_white_label_configuration"]]);
  });

  it.each(layouts)("passes explicit unavailable state to the $name shell after failure", async ({ render }) => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const shell = await render();
    expect(shell.props.runtimeConfiguration).toBeNull();
  });
});

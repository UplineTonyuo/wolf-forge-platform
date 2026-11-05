import { Children } from "react";
import { setImmediate } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InternalLayout from "../app/(internal)/layout";
import ClientAccountLayout from "../app/account/layout";
import { InternalShell } from "../components/shell/internal-shell";
import { ClientAccountShell } from "../components/account/client-account-shell";
import { ClientDraftProvider } from "../components/tickets/client-draft-provider";
import { ClientSupportBanner } from "../components/account/client-support-banner";
import type { MyProfile } from "../domain/profile/schema";
import type { StoreCatalog } from "../domain/services/store-projections";
import type { ClientNavCounts } from "../domain/client-portal/summary";

const state = vi.hoisted(() => ({
  internal: vi.fn(), client: vi.fn(), counts: vi.fn(), qa: vi.fn(), quickAccess: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: state.internal, getClientContext: state.client,
}));
vi.mock("../lib/supabase/client-portal-data", () => ({ getClientNavCounts: state.counts }));
vi.mock("../lib/qa/local-ui-bypass", () => ({
  localUiQaBypassEnabled: state.qa, isLocalQuickAccessSession: state.quickAccess,
}));
vi.mock("../components/shell/internal-shell", () => ({ InternalShell: () => null }));
vi.mock("../components/account/client-account-shell", () => ({ ClientAccountShell: () => null }));
vi.mock("../components/tickets/client-draft-provider", () => ({ ClientDraftProvider: () => null }));
vi.mock("../components/account/client-support-banner", () => ({ ClientSupportBanner: () => null }));

const tenantId = "aaaaaaaa-0000-4000-8000-000000000001";
const runtime = { kind: "unpublished", tenantId, publicationRevision: 0 };
const profile: MyProfile = {
  profileId: "client-a", displayName: "Synthetic client", email: null, roleName: "client",
  presetKey: null, presetName: null, avatarPath: "synthetic/avatar.png",
  avatarUrl: "https://example.invalid/avatar.png", notificationSoundEnabled: false,
  createdAt: "2026-11-05T00:00:00Z",
};
const catalog: StoreCatalog = {
  folders: [{ id: "folder-a", name: "SEO", description: null, services: [{
    id: "service-a", name: "Local SEO", folderId: "folder-a", priceLabel: "$25", amount: 25,
    currency: "USD", recurring: false, cadence: "one-time", recurringLabel: null,
    imageUrl: null, descriptionHtml: "", summary: "Local visibility",
  }] }],
  ungrouped: [], serviceCount: 1,
};
const counts: ClientNavCounts = { onboarding: 2, messages: 3, projects: 4, reporting: null };
const rpc = vi.fn();
const getMine = vi.fn();
const listStoreCatalog = vi.fn();
const isPlatformAdmin = vi.fn();
const context = {
  actor: { id: "client-a", support: undefined as object | undefined }, client: { rpc },
  user: { id: "client-a", tenantId, companyId: "company-a", modules: { settings: true, portal_store: true } },
  services: { profile: { getMine }, catalog: { listStoreCatalog }, permissions: { isPlatformAdmin } },
};
const layouts = [
  { name: "internal", render: InternalLayout, getContext: state.internal },
  { name: "client", render: ClientAccountLayout, getContext: state.client },
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function holdReads() {
  const branding = deferred<{ data: typeof runtime; error: null }>();
  const self = deferred<MyProfile | null>();
  const store = deferred<StoreCatalog>();
  const nav = deferred<ClientNavCounts | null>();
  rpc.mockReturnValue(branding.promise);
  getMine.mockReturnValue(self.promise);
  listStoreCatalog.mockReturnValue(store.promise);
  state.counts.mockReturnValue(nav.promise);
  return {
    branding, self, store, nav,
    finish() {
      branding.resolve({ data: runtime, error: null }); self.resolve(profile);
      store.resolve(catalog); nav.resolve(counts);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  context.actor.support = undefined;
  context.user.modules.portal_store = true;
  context.user.modules.settings = true;
  state.internal.mockResolvedValue(context);
  state.client.mockResolvedValue(context);
  state.qa.mockResolvedValue(false);
  state.quickAccess.mockResolvedValue(false);
  isPlatformAdmin.mockResolvedValue(true);
  rpc.mockResolvedValue({ data: runtime, error: null });
  getMine.mockResolvedValue(profile);
  listStoreCatalog.mockResolvedValue(catalog);
  state.counts.mockResolvedValue(counts);
});

describe.each(layouts)("$name shared shell reads", ({ name, render, getContext }) => {
  it("starts independent reads together only after context resolves", async () => {
    const auth = deferred<typeof context>();
    getContext.mockReturnValue(auth.promise);
    const pending = holdReads();
    const rendering = render({ children: "workspace" });
    const completed = vi.fn();
    void rendering.then(completed, () => undefined);
    try {
      expect(rpc).not.toHaveBeenCalled();
      expect(getMine).not.toHaveBeenCalled();
      expect(listStoreCatalog).not.toHaveBeenCalled();
      expect(state.counts).not.toHaveBeenCalled();
      expect(state.qa).not.toHaveBeenCalled();
      auth.resolve(context);
      // The layout's queued continuation runs; none of its read promises resolve.
      await Promise.resolve();
      expect(rpc.mock.calls).toEqual([["app_get_runtime_white_label_configuration"]]);
      expect(getMine).toHaveBeenCalledTimes(1);
      expect(listStoreCatalog).toHaveBeenCalledTimes(name === "client" ? 1 : 0);
      expect(state.counts).toHaveBeenCalledTimes(name === "client" ? 1 : 0);
      expect(completed).not.toHaveBeenCalled();
    } finally {
      auth.resolve(context);
      pending.finish();
      await rendering;
    }
  });

  it("starts no reads or QA/permission checks after authentication fails", async () => {
    const denied = new Error("synthetic authentication denial");
    getContext.mockRejectedValue(denied);
    await expect(render({ children: "workspace" })).rejects.toBe(denied);
    for (const read of [rpc, getMine, listStoreCatalog, state.counts, state.qa, state.quickAccess, isPlatformAdmin]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it.each(["branding", "profile"])("retains the individual %s failure fallback", async (failure) => {
    if (failure === "branding") rpc.mockRejectedValue(new Error("synthetic runtime failure"));
    else getMine.mockRejectedValue(new Error("synthetic profile failure"));
    const tree = await render({ children: "workspace" });
    const shell = name === "client" ? tree.props.children : tree;
    expect(shell.props.runtimeConfiguration).toEqual(failure === "branding" ? null : runtime);
    expect(shell.props.notificationSoundEnabled).toBe(failure === "profile");
    if (name === "client") {
      expect(shell.props.avatarUrl).toBe(failure === "profile" ? null : profile.avatarUrl);
      expect(shell.props.navCounts).toEqual(counts);
      expect(shell.props.serviceCatalog.services).toHaveLength(1);
    }
  });

  it("keeps profile defaults when no self-profile exists", async () => {
    getMine.mockResolvedValue(null);
    const tree = await render({ children: "workspace" });
    const shell = name === "client" ? tree.props.children : tree;
    expect(shell.props.notificationSoundEnabled).toBe(true);
    if (name === "client") expect(shell.props.avatarUrl).toBeNull();
  });
});

it.each(["branding", "self"] as const)("internal output remains correct when %s finishes last", async (last) => {
  const pending = holdReads();
  const rendering = InternalLayout({ children: "workspace" });
  const completed = vi.fn();
  void rendering.then(completed, () => undefined);
  await Promise.resolve();
  if (last === "branding") pending.self.resolve(profile);
  else pending.branding.resolve({ data: runtime, error: null });
  try {
    await setImmediate();
    expect(completed).not.toHaveBeenCalled();
  } finally {
    pending.finish();
  }
  const shell = await rendering;
  expect(shell.type).toBe(InternalShell);
  expect(shell.props).toMatchObject({ user: context.user, runtimeConfiguration: runtime, notificationSoundEnabled: false, showWhiteLabel: false });
  expect(shell.props.children).toBe("workspace");
});

it.each(["branding", "store", "nav", "self"] as const)("client output remains correct when %s finishes last", async (last) => {
  const pending = holdReads();
  const rendering = ClientAccountLayout({ children: "workspace" });
  const completed = vi.fn();
  void rendering.then(completed, () => undefined);
  await Promise.resolve();
  if (last !== "branding") pending.branding.resolve({ data: runtime, error: null });
  if (last !== "store") pending.store.resolve(catalog);
  if (last !== "nav") pending.nav.resolve(counts);
  if (last !== "self") pending.self.resolve(profile);
  try {
    await setImmediate();
    expect(completed).not.toHaveBeenCalled();
  } finally {
    pending.finish();
  }
  const provider = await rendering;
  expect(provider.type).toBe(ClientDraftProvider);
  expect(provider.key).toBe("company-a:client-a");
  const shell = provider.props.children;
  expect(shell.type).toBe(ClientAccountShell);
  expect(shell.props).toMatchObject({ user: context.user, runtimeConfiguration: runtime, navCounts: counts, notificationSoundEnabled: false, avatarUrl: profile.avatarUrl });
  expect(shell.props.serviceCatalog).toEqual({
    folders: [{ id: "folder-a", name: "SEO", description: null, serviceCount: 1 }],
    services: [{ id: "service-a", name: "Local SEO", priceLabel: "$25", recurringLabel: null, summary: "Local visibility", folderId: "folder-a", folderName: "SEO", href: "/account/store/service-a" }],
  });
  expect(Children.toArray(shell.props.children)).toEqual(["workspace"]);
});

it("skips the catalog entirely for Store-disabled accounts and retains the empty chooser", async () => {
  context.user.modules.portal_store = false;
  const pending = holdReads();
  const rendering = ClientAccountLayout({ children: "workspace" });
  try {
    await Promise.resolve();
    expect(listStoreCatalog).not.toHaveBeenCalled();
    expect(state.counts).toHaveBeenCalledTimes(1);
    expect(getMine).toHaveBeenCalledTimes(1);
  } finally {
    pending.finish();
    const provider = await rendering;
    expect(provider.props.children.props.serviceCatalog).toEqual({ folders: [], services: [] });
  }
});

it("keeps a navigation failure nonfatal without changing other client output", async () => {
  state.counts.mockRejectedValue(new Error("synthetic nav failure"));
  const provider = await ClientAccountLayout({ children: "workspace" });
  expect(provider.props.children.props).toMatchObject({ navCounts: null, runtimeConfiguration: runtime, notificationSoundEnabled: false, avatarUrl: profile.avatarUrl });
  expect(provider.props.children.props.serviceCatalog.services).toHaveLength(1);
});

it.each(["read", "projection"] as const)("propagates catalog %s failure while handling every other started rejection", async (failure) => {
  const pending = holdReads();
  const rendering = ClientAccountLayout({ children: "workspace" });
  const error = new Error("synthetic catalog failure");
  const failed = expect(rendering).rejects.toBe(error);
  await Promise.resolve();
  if (failure === "read") pending.store.reject(error);
  else pending.store.resolve({ ...catalog, get folders(): StoreCatalog["folders"] { throw error; } });
  try {
    await failed;
  } finally {
    pending.branding.reject(new Error("synthetic late runtime failure"));
    pending.nav.reject(new Error("synthetic late nav failure"));
    pending.self.reject(new Error("synthetic late profile failure"));
  }
  // Drain late rejection handlers; Vitest treats unhandled rejections as failures.
  await setImmediate();
});

it("keeps the support banner and draft provider boundary", async () => {
  context.actor.support = { displayName: "Synthetic support client" };
  const provider = await ClientAccountLayout({ children: "workspace" });
  expect(provider.type).toBe(ClientDraftProvider);
  const [banner, children] = provider.props.children.props.children;
  expect(banner.type).toBe(ClientSupportBanner);
  expect(banner.props.support).toBe(context.actor.support);
  expect(children).toBe("workspace");
});

it.each([
  { qa: false, quick: false, settings: true, admin: true, visible: false, quickCalls: 0, adminCalls: 0 },
  { qa: true, quick: true, settings: true, admin: true, visible: false, quickCalls: 1, adminCalls: 0 },
  { qa: true, quick: false, settings: false, admin: true, visible: false, quickCalls: 1, adminCalls: 0 },
  { qa: true, quick: false, settings: true, admin: false, visible: false, quickCalls: 1, adminCalls: 1 },
  { qa: true, quick: false, settings: true, admin: true, visible: true, quickCalls: 1, adminCalls: 1 },
])("preserves White-Label conditions %j", async ({ qa, quick, settings, admin, visible, quickCalls, adminCalls }) => {
  state.qa.mockResolvedValue(qa);
  state.quickAccess.mockResolvedValue(quick);
  context.user.modules.settings = settings;
  isPlatformAdmin.mockResolvedValue(admin);
  const shell = await InternalLayout({ children: "workspace" });
  expect(shell.props.showWhiteLabel).toBe(visible);
  expect(state.quickAccess).toHaveBeenCalledTimes(quickCalls);
  if (quickCalls) expect(state.quickAccess).toHaveBeenCalledWith(context.actor);
  expect(isPlatformAdmin).toHaveBeenCalledTimes(adminCalls);
});

it("keeps a failed Platform Admin lookup fail-closed", async () => {
  state.qa.mockResolvedValue(true);
  isPlatformAdmin.mockRejectedValue(new Error("synthetic permission failure"));
  expect((await InternalLayout({ children: "workspace" })).props.showWhiteLabel).toBe(false);
});

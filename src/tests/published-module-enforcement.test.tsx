/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InternalUser } from "../lib/supabase/next-server";
import { WorkspaceQuickAction } from "../components/shell/workspace-quick-action";
import { navigationForModules } from "../components/shell/nav-registry";
import { portalNavigationFor } from "../components/account/portal-nav-registry";

const mocks = vi.hoisted(() => ({
  requireModuleAccess: vi.fn(), listActive: vi.fn(),
  enforceServerCostLimit: vi.fn(), send: vi.fn(), sendDraft: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({ actor: { id: "qa-actor" }, services: {
    permissions: { requireModuleAccess: mocks.requireModuleAccess },
    companies: { listActive: mocks.listActive },
    reporting: { send: mocks.send, sendDraft: mocks.sendDraft },
  }}),
}));
vi.mock("../lib/security/server-cost-limit", () => ({
  enforceServerCostLimit: mocks.enforceServerCostLimit,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("../components/shell/use-header-overlay", () => ({
  useHeaderOverlay: () => {},
}));
const { listReportRecipientsAction, sendClientReportAction, sendReportDraftAction } = await import("../app/actions/reporting");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModuleAccess.mockResolvedValue(true);
  mocks.listActive.mockResolvedValue([{ id: "client", name: "QA" }]);
  mocks.enforceServerCostLimit.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
  mocks.sendDraft.mockResolvedValue(undefined);
});
afterEach(cleanup);

const sendCases = [
  {
    name: "legacy send",
    invoke: () => sendClientReportAction({
      requestId: "request", companyId: "client", reportLane: "seo_package",
      packageLabel: "QA", title: "QA", reportUrl: "https://example.invalid/report",
    }),
    mutation: mocks.send,
  },
  {
    name: "draft send",
    invoke: () => sendReportDraftAction({ requestId: "request", reportId: "report" }),
    mutation: mocks.sendDraft,
  },
];

it.each(sendCases)("$name rejects denied Reporting before consuming quota or sending", async ({ invoke, mutation }) => {
  mocks.requireModuleAccess.mockRejectedValue(new Error("denied"));
  expect(await invoke()).toMatchObject({ ok: false });
  expect(mocks.requireModuleAccess).toHaveBeenCalledWith("reporting");
  expect(mocks.enforceServerCostLimit).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});

it.each(sendCases)("$name preserves module-check, quota, send ordering when allowed", async ({ invoke, mutation }) => {
  expect(await invoke()).toEqual({ ok: true });
  expect(mocks.requireModuleAccess).toHaveBeenCalledWith("reporting");
  expect(mocks.requireModuleAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.enforceServerCostLimit.mock.invocationCallOrder[0]!);
  expect(mocks.enforceServerCostLimit.mock.invocationCallOrder[0]).toBeLessThan(mutation.mock.invocationCallOrder[0]!);
});

it("does not read recipients when Reporting is denied", async () => {
  mocks.requireModuleAccess.mockRejectedValue(new Error("denied"));
  expect(await listReportRecipientsAction()).toEqual([]);
  expect(mocks.requireModuleAccess).toHaveBeenCalledWith("reporting");
  expect(mocks.listActive).not.toHaveBeenCalled();
});
it("preserves legitimate recipient access", async () => {
  expect(await listReportRecipientsAction()).toEqual([{ id: "client", name: "QA" }]);
  expect(mocks.requireModuleAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.listActive.mock.invocationCallOrder[0]!);
});
it.each([false, true])("quick action respects authoritative reporting=%s even for owner", (reporting) => {
  const user = { displayName: "QA Owner", role: "owner", modules: { reporting } } as unknown as InternalUser;
  render(<WorkspaceQuickAction user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "Quick Action" }));
  expect(screen.queryByRole("link", { name: /Send Reporting/ }) !== null).toBe(reporting);
});
it("both nav registries omit disabled Reporting", () => {
  expect(JSON.stringify(navigationForModules({ reporting: false }))).not.toContain('"/reporting"');
  expect(JSON.stringify(portalNavigationFor({ portal_reporting: false }))).not.toContain('"/account/reporting"');
});

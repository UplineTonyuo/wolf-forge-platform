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
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({ services: {
    permissions: { requireModuleAccess: mocks.requireModuleAccess },
    companies: { listActive: mocks.listActive },
  }}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("../components/shell/use-header-overlay", () => ({
  useHeaderOverlay: () => {},
}));
const { listReportRecipientsAction } = await import("../app/actions/reporting");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModuleAccess.mockResolvedValue(true);
  mocks.listActive.mockResolvedValue([{ id: "client", name: "QA" }]);
});
afterEach(cleanup);

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

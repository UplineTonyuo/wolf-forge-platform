// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../app/account/projects/[projectId]/page";
const mocks = vi.hoisted(() => ({ project: vi.fn(), start: vi.fn(), assignments: vi.fn(), require: vi.fn(), visibility: vi.fn() }));
const modules = { portal_projects: true, portal_forms: true };
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("../components/account/projects/client-projects", () => ({ ClientProjectDetail: ({ startControl }: { startControl: import("react").ReactNode }) => startControl }));
vi.mock("../components/account/projects/client-order-start", () => ({ ClientOrderStart: () => <p>Frozen gate</p> }));
vi.mock("../components/forms/forms-visibility-boundary", () => ({ FormsVisibilityBoundary: ({ children }: { children: import("react").ReactNode }) => <section aria-label="Live form access">{children}</section> }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: mocks.visibility }));
vi.mock("../lib/supabase/client-portal-data", () => ({ readClientAssignments: mocks.assignments }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: async () => ({
  user: { id: "client", modules },
  services: { permissions: { requireModuleAccess: mocks.require }, projects: { getClientProject: mocks.project, getClientStartState: mocks.start }, tickets: { getOrderPage: async () => null } },
}) }));
beforeEach(() => {
  vi.resetAllMocks();
  modules.portal_forms = true;
  mocks.project.mockResolvedValue({ id: "order" });
  mocks.start.mockResolvedValue(null);
  mocks.visibility.mockResolvedValue({ ok: true, signature: "scope" });
  mocks.assignments.mockResolvedValue([
    { order_id: "order", assignment_id: "required", form_type: "intake", required: true, status: "assigned", title: "Service intake" },
    { order_id: "other", assignment_id: "foreign", form_type: "intake", required: true, status: "assigned", title: "Other order" },
  ]);
});
afterEach(cleanup);
it("keeps legacy required forms reachable with live access redaction and no start mutation", async () => {
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByRole("region", { name: "Live form access" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Complete intake form/ }).getAttribute("href")).toBe("/account/onboarding/required");
  expect(screen.queryByText(/Other order/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
});
it("does not read legacy form metadata without Forms permission", async () => {
  modules.portal_forms = false;
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(mocks.assignments).not.toHaveBeenCalled();
  expect(mocks.visibility).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).toBeNull();
});
it("does not expose forms when the live visibility check is denied", async () => {
  mocks.visibility.mockResolvedValue({ ok: false, denied: true });
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(mocks.assignments).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
});
it("does not downgrade a failed frozen-gate lookup to legacy or permit a start", async () => {
  mocks.start.mockRejectedValue(new Error("Unavailable"));
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(mocks.assignments).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/start status could not be loaded/);
});

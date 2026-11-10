// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../app/account/projects/[projectId]/page";
const mocks = vi.hoisted(() => ({ project: vi.fn(), start: vi.fn(), eligibility: vi.fn(), conversation: vi.fn(), assignments: vi.fn(), require: vi.fn(), visibility: vi.fn() }));
const modules = { portal_projects: true, portal_forms: true };
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("../components/account/projects/client-projects", () => ({ ClientProjectDetail: ({ startControl, chatAccess, conversation }: { startControl: import("react").ReactNode; chatAccess: string; conversation: unknown }) => <>{startControl}<p>{chatAccess}</p>{conversation ? <p>Conversation data</p> : null}</> }));
vi.mock("../components/account/projects/client-order-start", () => ({ ClientOrderStart: () => <p>Frozen gate</p> }));
vi.mock("../components/forms/forms-visibility-boundary", () => ({ FormsVisibilityBoundary: ({ children }: { children: import("react").ReactNode }) => <section aria-label="Live form access">{children}</section> }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: mocks.visibility }));
vi.mock("../lib/supabase/client-portal-data", () => ({ readClientAssignments: mocks.assignments }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: async () => ({
  user: { id: "client", modules },
  services: { permissions: { requireModuleAccess: mocks.require }, projects: { getClientProject: mocks.project, getClientStartState: mocks.start, getClientChatEligibility: mocks.eligibility }, tickets: { getOrderPage: mocks.conversation } },
}) }));
beforeEach(() => {
  vi.resetAllMocks();
  modules.portal_forms = true;
  mocks.project.mockResolvedValue({ id: "order" });
  mocks.start.mockResolvedValue(null);
  mocks.eligibility.mockResolvedValue(false);
  mocks.conversation.mockResolvedValue({ messages: [] });
  mocks.visibility.mockResolvedValue({ ok: true, signature: "scope" });
  mocks.assignments.mockResolvedValue([
    { order_id: "order", assignment_id: "required", form_type: "intake", required: true, status: "assigned", title: "Service intake" },
    { order_id: "other", assignment_id: "foreign", form_type: "intake", required: true, status: "assigned", title: "Other order" },
  ]);
});
afterEach(cleanup);
it("does not request or serialize chat for an authoritative locked Project", async () => {
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByText("locked")).toBeTruthy();
  expect(screen.queryByText("Conversation data")).toBeNull();
  expect(mocks.conversation).not.toHaveBeenCalled();
});
it("waits for authoritative eligibility before reading an empty unlocked conversation", async () => {
  let finish!: (eligible: boolean) => void;
  mocks.eligibility.mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
  mocks.assignments.mockResolvedValue([]);
  const pending = Page({ params: Promise.resolve({ projectId: "order" }) });
  await vi.waitFor(() => expect(mocks.eligibility).toHaveBeenCalledWith("order"));
  expect(mocks.conversation).not.toHaveBeenCalled();
  finish(true);
  render(await pending);
  expect(screen.getByText("unlocked")).toBeTruthy();
  expect(mocks.conversation).toHaveBeenCalledOnce();
});
it("keeps Project/forms while eligibility fails closed", async () => {
  mocks.eligibility.mockRejectedValue(new Error("read failed"));
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByText("unavailable")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Complete intake form/ })).toBeTruthy();
  expect(mocks.conversation).not.toHaveBeenCalled();
});
it("does not open chat on a form visibility failure even if eligibility was true", async () => {
  mocks.eligibility.mockResolvedValue(true);
  mocks.visibility.mockResolvedValue({ ok: false, denied: true });
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(mocks.conversation).not.toHaveBeenCalled();
  expect(screen.getByText("unavailable")).toBeTruthy();
});
it("does not treat a missing assignment read as an empty legacy requirement list", async () => {
  mocks.eligibility.mockResolvedValue(true);
  mocks.assignments.mockResolvedValue(null);
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(mocks.conversation).not.toHaveBeenCalled();
  expect(screen.getByText("unavailable")).toBeTruthy();
});
it("keeps an expected chat denial on the Project instead of redirecting", async () => {
  mocks.eligibility.mockResolvedValue(true);
  mocks.assignments.mockResolvedValue([]);
  mocks.conversation.mockRejectedValue(new Error("read revoked"));
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByText("unavailable")).toBeTruthy();
});
it("keeps legacy required forms reachable with live access redaction and no start mutation", async () => {
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByRole("region", { name: "Live form access" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Complete intake form/ }).getAttribute("href")).toBe("/account/onboarding/required");
  expect(screen.queryByText(/Other order/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
});
it("keeps a new required form reachable after the frozen start gate has already started", async () => {
  mocks.start.mockResolvedValue({ order_id: "order", status: "working", requested: true, started: true, available: false,
    forms: [{ id: "frozen-complete", title: "Original form", completed: true, available: false }] });
  render(await Page({ params: Promise.resolve({ projectId: "order" }) }));
  expect(screen.getByRole("link", { name: /Complete intake form/ }).getAttribute("href")).toBe("/account/onboarding/required");
  expect(mocks.conversation).not.toHaveBeenCalled();
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

/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getDraftAction, saveDraftAction } = vi.hoisted(() => ({ getDraftAction: vi.fn(), saveDraftAction: vi.fn() }));
vi.mock("../app/actions/white-label", () => ({
  getWhiteLabelDraftAction: getDraftAction,
  saveWhiteLabelDraftAction: saveDraftAction,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/white-label", useRouter: () => ({ push: vi.fn() }) }));

import { WhiteLabelDraftEditor } from "../components/white-label/white-label-draft-editor";
import {
  draftModuleKeys,
  draftProblem,
  modulesFromKeys,
  saveWhiteLabelDraftSchema,
  type WhiteLabelDraft,
  type WhiteLabelTenant,
} from "../domain/white-label/draft";
import { SYNTHETIC_PREVIEW_STATE, WHITE_LABEL_MODULES } from "../domain/white-label/preview";
import { WhiteLabelRepository } from "../repositories/white-label-repository";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WF: WhiteLabelTenant = { id: "f0f0f0f0-0000-4000-8000-000000000001", slug: "wolf-forge", displayName: "Wolf Forge", status: "active", draftRevision: null };
const B: WhiteLabelTenant = { id: "f0f0f0f0-0000-4000-8000-000000002601", slug: "tenant-b", displayName: "Tenant B", status: "active", draftRevision: 2 };
const SUSPENDED: WhiteLabelTenant = { id: "f0f0f0f0-0000-4000-8000-000000002699", slug: "tenant-s", displayName: "Tenant S", status: "suspended", draftRevision: null };

function draftFor(tenant: WhiteLabelTenant, displayName: string, revision: number): WhiteLabelDraft {
  return {
    tenantId: tenant.id,
    tenantStatus: tenant.status,
    state: { ...SYNTHETIC_PREVIEW_STATE, displayName },
    revision,
    updatedAt: revision ? "2026-10-09T00:00:00.000Z" : null,
  };
}

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolveValue = done));
  return { promise, resolve: resolveValue };
}

function chooseTenant(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Tenant:/ }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
}

const nameInput = () => screen.getByLabelText("Workspace display name");
const saveButton = () => screen.getByRole("button", { name: /Save Draft|Saving/ });

describe("White Label draft rules", () => {
  it("keeps frontend starting selections in parity with the forward SQL fallback", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261010120000_white_label_recommended_draft_defaults.sql"), "utf8");
    const fallback = sql.match(/catalog\.module_key in \(([^)]+)\)/)?.[1] ?? "";
    const keys = [...fallback.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(keys).toEqual(["forms", "invoices", "projects", "reporting", "services", "tickets"]);
    expect(draftModuleKeys(SYNTHETIC_PREVIEW_STATE.modules)).toEqual(keys);
  });
  it("accepts a valid draft and stores modules as a sorted set", () => {
    expect(draftProblem(SYNTHETIC_PREVIEW_STATE)).toBeNull();
    expect(draftModuleKeys({ tickets: true, services: true, todo: true, unknown: true })).toEqual(["services", "tickets"]);
    expect(modulesFromKeys(["services"])).toMatchObject({ services: true, projects: false });
  });

  it("refuses blank, long and control-character names, and bad colors", () => {
    expect(draftProblem({ ...SYNTHETIC_PREVIEW_STATE, displayName: "  " })).toMatch(/Enter/);
    expect(draftProblem({ ...SYNTHETIC_PREVIEW_STATE, displayName: "x".repeat(61) })).toMatch(/60/);
    expect(draftProblem({ ...SYNTHETIC_PREVIEW_STATE, displayName: "A\u0007B" })).toMatch(/cannot be shown/);
    expect(draftProblem({ ...SYNTHETIC_PREVIEW_STATE, primaryColor: "red" })).toMatch(/colors/);
  });

  it("refuses a module without the module it requires", () => {
    const modules = { ...SYNTHETIC_PREVIEW_STATE.modules, services: false };
    expect(draftProblem({ ...SYNTHETIC_PREVIEW_STATE, modules })).toBe("Projects needs Services. Turn Services on, or turn Projects off.");
  });

  it("the server schema rejects Operations, unknown modules, extra fields and invalid dependencies", () => {
    const valid = {
      tenantId: B.id,
      expectedRevision: 2,
      displayName: "Acme",
      primaryColor: "#000d51",
      accentColor: "#a8832e",
      moduleKeys: ["services", "projects"],
    };
    expect(saveWhiteLabelDraftSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, moduleKeys: ["todo"] },
      { ...valid, moduleKeys: ["dashboard"] },
      { ...valid, moduleKeys: ["projects"] },
      { ...valid, primaryColor: "#00f" },
      { ...valid, tenantId: "wolf-forge" },
      { ...valid, expectedRevision: -1 },
      { ...valid, role: "platform_admin" },
    ]) {
      expect(saveWhiteLabelDraftSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("the client catalog matches the database catalog exactly (keys and dependencies)", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261010090000_white_label_drafts.sql"), "utf8");
    const seeded = [...sql.matchAll(/\('([a-z_]+)', (?:null|'([a-z_]+)')\)/g)].map(([, key, requires]) => [key, requires ?? null] as const);
    const client = WHITE_LABEL_MODULES.map((entry) => [entry.id, entry.requires[0] ?? null] as const);
    expect(new Map(seeded)).toEqual(new Map(client));
    expect(client.map(([id]) => id)).not.toContain("todo");
  });
});

describe("White Label draft editor", () => {
  it("invalid custom hex blocks Review and Save rather than silently saving the previous color", () => {
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#bad!" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review Draft" })).toBeDisabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Forest Premium" }));
    expect(saveButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review Draft" })).toBeEnabled();
    expect(saveDraftAction).not.toHaveBeenCalled();
  });
  it("replays an uncertain save exactly and preserves edits made after its lost response", async () => {
    saveDraftAction.mockRejectedValueOnce(new TypeError("lost response"));
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "First change" } });
    await act(async () => fireEvent.click(saveButton()));
    const original = saveDraftAction.mock.calls[0]?.[0];
    expect(original).toBeDefined();
    fireEvent.change(nameInput(), { target: { value: "Newer change" } });
    saveDraftAction.mockResolvedValueOnce({ ok: true, data: { revision: 3, updatedAt: "2026-10-12T00:00:00.000Z" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(saveDraftAction.mock.calls[1]?.[0]).toEqual(original);
    expect(nameInput()).toHaveValue("Newer change");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    saveDraftAction.mockResolvedValueOnce({ ok: true, data: { revision: 4, updatedAt: "2026-10-12T01:00:00.000Z" } });
    await act(async () => fireEvent.click(saveButton()));
    expect(saveDraftAction).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3, displayName: "Newer change" }));
  });
  it("does not send concurrent Save clicks before React commits its busy state", async () => {
    const save = deferred<unknown>();
    saveDraftAction.mockReturnValue(save.promise);
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Changed" } });
    const button = saveButton();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(saveDraftAction).toHaveBeenCalledOnce();
    await act(async () => save.resolve({ ok: true, data: { revision: 3, updatedAt: "2026-10-12T00:00:00.000Z" } }));
  });
  it("closes the mobile drawer before departure confirmation and returns focus to its trigger", () => {
    render(<><button aria-controls="mobile-navigation">Open navigation</button><dialog open><a href="/dashboard">Mobile departure</a></dialog><WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} /></>);
    const drawer = screen.getByRole("dialog") as HTMLDialogElement;
    drawer.close = vi.fn(() => { drawer.open = false; });
    fireEvent.change(nameInput(), { target: { value: "Unsaved" } });
    fireEvent.click(screen.getByRole("link", { name: "Mobile departure" }));
    expect(drawer.close).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });
  it("warns before an app-link departure and Escape restores the link's focus", () => {
    render(<><a href="/dashboard">Dashboard departure</a><WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} /></>);
    fireEvent.change(nameInput(), { target: { value: "Unsaved" } });
    const link = screen.getByRole("link", { name: "Dashboard departure" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    const keep = screen.getByRole("button", { name: "Keep editing" });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: "Escape" });
    expect(link).toHaveFocus();
    expect(nameInput()).toHaveValue("Unsaved");
    expect(screen.queryByRole("button", { name: "Discard and leave" })).toBeNull();
  });
  it("loads saved selections exactly and saves explicit non-recommended choices", async () => {
    const saved = draftFor(B, "Existing saved configuration", 2);
    saved.state.modules = modulesFromKeys(["services", "subscriptions", "coupons", "investment_intent"]);
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={saved} />);
    for (const label of ["Subscriptions", "Coupons", "Investment Intent"]) expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reporting" })).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Forms" }));
    saveDraftAction.mockResolvedValue({ ok: true, data: { revision: 3, updatedAt: "2026-10-10T00:00:00.000Z" } });
    await act(async () => fireEvent.click(saveButton()));
    expect(saveDraftAction).toHaveBeenCalledWith(expect.objectContaining({ moduleKeys: ["coupons", "forms", "investment_intent", "services", "subscriptions"] }));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
  it("requires an explicit Tenant before anything can be saved", () => {
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={null} />);
    expect(screen.getByText("Choose a Tenant")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(getDraftAction).not.toHaveBeenCalled();
  });

  it("saves only through the server and reports success only after it confirms", async () => {
    const save = deferred<unknown>();
    saveDraftAction.mockReturnValue(save.promise);
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    expect(saveButton()).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: "  Bravo Labs " } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(saveButton());

    expect(saveDraftAction).toHaveBeenCalledExactlyOnceWith({
      tenantId: B.id,
      expectedRevision: 2,
      displayName: "Bravo Labs",
      primaryColor: SYNTHETIC_PREVIEW_STATE.primaryColor,
      accentColor: SYNTHETIC_PREVIEW_STATE.accentColor,
      moduleKeys: draftModuleKeys(SYNTHETIC_PREVIEW_STATE.modules),
    });
    expect(saveButton()).toHaveTextContent("Saving");
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    expect(screen.getByRole("group", { name: "Workspace identity" })).toBeDisabled();

    await act(async () => save.resolve({ ok: true, data: { revision: 3, updatedAt: "2026-10-09T01:00:00.000Z" } }));
    expect(screen.getByText(/Draft saved · revision 3/)).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.getByTestId("draft-revision")).toHaveTextContent("Draft revision 3");
  });

  it("a failed save keeps the changes, never claims success, and can be retried", async () => {
    saveDraftAction.mockResolvedValueOnce({ ok: false, error: { code: "DATABASE_ERROR", message: "x" } });
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Bravo Labs" } });
    await act(async () => fireEvent.click(saveButton()));

    expect(screen.getByText(/could not be saved. Your changes are still here/)).toBeInTheDocument();
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    expect(nameInput()).toHaveValue("Bravo Labs");

    saveDraftAction.mockResolvedValueOnce({ ok: true, data: { revision: 3, updatedAt: "2026-10-09T01:00:00.000Z" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(saveDraftAction).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Draft saved · revision 3/)).toBeInTheDocument();
  });

  it("a lost response (network failure) is a retryable failure, not a crash", async () => {
    saveDraftAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Bravo Labs" } });
    await act(async () => fireEvent.click(saveButton()));

    expect(screen.getByText(/could not be saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    expect(nameInput()).toHaveValue("Bravo Labs");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a stale revision is an explicit conflict; loading the latest discards local edits", async () => {
    saveDraftAction.mockResolvedValue({ ok: false, error: { code: "CONFLICT", message: "x" } });
    getDraftAction.mockResolvedValue({ ok: true, data: draftFor(B, "Theirs", 3) });
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Mine" } });
    await act(async () => fireEvent.click(saveButton()));

    expect(screen.getByText(/Someone else saved this Tenant's draft/)).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Mine");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Load latest/ })));
    expect(getDraftAction).toHaveBeenCalledWith(B.id);
    expect(nameInput()).toHaveValue("Theirs");
  });

  it("an invalid dependency is reported and never sent", async () => {
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^Services/ }));
    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByText(/Projects needs Services/)).toBeInTheDocument();
    expect(saveDraftAction).not.toHaveBeenCalled();
  });

  it("warns before switching Tenants with unsaved changes and never carries them over", async () => {
    getDraftAction.mockResolvedValue({ ok: true, data: draftFor(WF, "Wolf Forge", 0) });
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Bravo edited" } });

    chooseTenant("Wolf Forge");
    expect(screen.getByText(/unsaved changes to Tenant B/)).toBeInTheDocument();
    expect(getDraftAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(nameInput()).toHaveValue("Bravo edited");

    chooseTenant("Wolf Forge");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard and switch" })));
    expect(getDraftAction).toHaveBeenCalledExactlyOnceWith(WF.id);
    expect(nameInput()).toHaveValue("Wolf Forge");
    expect(screen.getByTestId("draft-revision")).toHaveTextContent("No draft saved yet");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("a slow response for the previous Tenant never replaces the current one", async () => {
    const slowWf = deferred<unknown>();
    getDraftAction.mockImplementation((id: string) =>
      id === WF.id ? slowWf.promise : Promise.resolve({ ok: true, data: draftFor(B, "Bravo", 2) }),
    );
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={null} />);
    chooseTenant("Wolf Forge");
    await act(async () => chooseTenant("Tenant B"));
    expect(nameInput()).toHaveValue("Bravo");

    await act(async () => slowWf.resolve({ ok: true, data: draftFor(WF, "Wolf Forge", 0) }));
    expect(nameInput()).toHaveValue("Bravo");
    expect(screen.getByRole("button", { name: /^Tenant:/ })).toHaveAccessibleName("Tenant: Tenant B");
  });

  it("a suspended Tenant's draft is read-only", () => {
    render(<WhiteLabelDraftEditor tenants={[SUSPENDED]} initialDraft={draftFor(SUSPENDED, "Tenant S", 0)} />);
    expect(screen.getByRole("group", { name: "Workspace identity" })).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/suspended, so its draft is read-only/)).toBeInTheDocument();
  });

  it("losing access while open shows a refusal, not stale data", async () => {
    getDraftAction.mockResolvedValue({ ok: false, error: { code: "PERMISSION_DENIED", message: "x" } });
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={draftFor(B, "Bravo", 2)} />);
    chooseTenant("Wolf Forge");
    await act(async () => {});
    expect(screen.getByText(/not available to you/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace display name")).toBeNull();
  });
});

describe("White Label draft review", () => {
  const openReview = () => fireEvent.click(screen.getByRole("button", { name: "Review Draft" }));

  it("compares unsaved identity, colors and modules with the loaded draft without server calls", () => {
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded workspace", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Proposed workspace" } });
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#654321" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /^Reporting/ }));
    openReview();
    const review = screen.getByRole("region", { name: "White Label Draft Review" });
    expect(within(review).getByText("Loaded workspace")).toBeInTheDocument();
    expect(within(review).getByText("Proposed workspace")).toBeInTheDocument();
    expect(within(review).getByText("#123456")).toBeInTheDocument();
    expect(within(review).getByText("#654321")).toBeInTheDocument();
    expect(within(review).getByText("5 enabled · 4 disabled in this draft.")).toBeInTheDocument();
    expect(within(review).getByText("Enabled → Disabled")).toBeInTheDocument();
    expect(within(review).getByText(/Compared with loaded draft revision 2/)).toBeInTheDocument();
    expect(within(review).getByRole("heading", { name: "Review draft" })).toHaveFocus();
    expect(getDraftAction).not.toHaveBeenCalled();
    expect(saveDraftAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Publish|Activate/ })).toBeNull();
  });

  it("returns to editing with values, module selections, device and keyboard focus intact", () => {
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "My unsaved draft" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /^Reporting/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    openReview();
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(nameInput()).toHaveValue("My unsaved draft");
    expect(screen.getByRole("checkbox", { name: /^Reporting/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review Draft" })).toHaveFocus();
    expect(saveDraftAction).not.toHaveBeenCalled();
  });

  it("shows existing dependency and contrast warnings while retaining invalid edits", () => {
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    for (const label of ["Subscriptions", "Coupons", "Investment Intent"]) fireEvent.click(screen.getByRole("checkbox", { name: label }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Services/ }));
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#ffffff" } });
    openReview();
    const review = screen.getByRole("region", { name: "White Label Draft Review" });
    expect(within(review).getByText("Projects needs Services. Turn Services on, or turn Projects off.")).toBeInTheDocument();
    expect(within(review).getAllByText("Requires Services.")).toHaveLength(4);
    expect(within(review).getAllByText("Dependency missing; hidden in preview.")).toHaveLength(4);
    expect(within(review).getByText(/Sidebar text may be hard to read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(screen.getByRole("checkbox", { name: /^Services/ })).not.toBeChecked();
    expect(screen.getByLabelText("Primary color")).toHaveValue("#ffffff");
  });

  it("labels loaded defaults and an unchanged draft without implying publication", () => {
    render(<WhiteLabelDraftEditor tenants={[WF]} initialDraft={draftFor(WF, "Wolf Forge", 0)} />);
    openReview();
    expect(screen.getByText("Compared with loaded defaults. No draft has been saved yet.")).toBeInTheDocument();
    expect(screen.getByText("No unsaved changes to review.")).toBeInTheDocument();
    expect(screen.getByText(/Reviewing applies nothing/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("permits read-only review without enabling edits for a suspended Tenant", () => {
    render(<WhiteLabelDraftEditor tenants={[SUSPENDED]} initialDraft={draftFor(SUSPENDED, "Suspended", 2)} />);
    openReview();
    expect(screen.getByRole("region", { name: "White Label Draft Review" })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(nameInput()).toBeDisabled();
    expect(saveDraftAction).not.toHaveBeenCalled();
  });

  it("clears the review when a different Tenant is loaded", async () => {
    getDraftAction.mockResolvedValue({ ok: true, data: draftFor(B, "Tenant B draft", 2) });
    render(<WhiteLabelDraftEditor tenants={[WF, B]} initialDraft={draftFor(WF, "Wolf Forge", 0)} />);
    openReview();
    chooseTenant("Tenant B");
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "White Label Draft Review" })).toBeNull();
    expect(nameInput()).toHaveValue("Tenant B draft");
  });

  it("compares with the newly confirmed draft after saving from review", async () => {
    saveDraftAction.mockResolvedValue({ ok: true, data: { revision: 3, updatedAt: "2026-10-09T01:00:00.000Z" } });
    render(<WhiteLabelDraftEditor tenants={[B]} initialDraft={draftFor(B, "Loaded", 2)} />);
    fireEvent.change(nameInput(), { target: { value: "Proposed" } });
    openReview();
    fireEvent.click(saveButton());
    await act(async () => {});
    const review = screen.getByRole("region", { name: "White Label Draft Review" });
    expect(within(review).getByText(/Compared with loaded draft revision 3/)).toBeInTheDocument();
    expect(within(review).getByText("No unsaved changes to review.")).toBeInTheDocument();
    expect(within(review).getAllByText("Proposed", { selector: "td" })).toHaveLength(2);
    expect(saveButton()).toBeDisabled();
  });
});

describe("White Label repository", () => {
  function repositoryReturning(result: unknown) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { repository: new WhiteLabelRepository({ rpc } as never), rpc };
  }
  const input = {
    tenantId: B.id,
    expectedRevision: 2,
    displayName: "Acme",
    primaryColor: "#000d51",
    accentColor: "#a8832e",
    moduleKeys: ["services"],
  };

  it.each([
    [{ code: "WF409" }, "CONFLICT"],
    [{ code: "55000" }, "VALIDATION_ERROR"],
    [{ code: "42501" }, "PERMISSION_DENIED"],
    [{ code: "P0002" }, "NOT_FOUND"],
    [{ code: "23514" }, "VALIDATION_ERROR"],
  ])("maps save error %o to %s", async (error, code) => {
    const { repository } = repositoryReturning({ data: null, error });
    await expect(repository.saveDraft(input)).rejects.toMatchObject({ code });
  });

  it("never reports an unconfirmed write as saved", async () => {
    const { repository } = repositoryReturning({ data: [], error: null });
    await expect(repository.saveDraft(input)).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("sends exactly the validated values to the save RPC", async () => {
    const { repository, rpc } = repositoryReturning({ data: [{ revision: 3, updated_at: "t", already_applied: false }], error: null });
    await expect(repository.saveDraft(input)).resolves.toEqual({ revision: 3, updatedAt: "t" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_save_white_label_draft", {
      p_tenant_id: B.id,
      p_expected_revision: 2,
      p_display_name: "Acme",
      p_primary_color: "#000d51",
      p_accent_color: "#a8832e",
      p_module_keys: ["services"],
    });
  });
});

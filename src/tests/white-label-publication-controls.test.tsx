/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicationPreflight, PublicationReceipt, PublishWhiteLabelInput } from "../domain/white-label/publication";
import type { WhiteLabelDraft } from "../domain/white-label/draft";
import { modulesFromKeys } from "../domain/white-label/draft";
import { readPublicationIntent, storePublicationIntent } from "../components/white-label/publication-intent";
const actions = vi.hoisted(() => ({ preflight: vi.fn(), publish: vi.fn(), reconcile: vi.fn() }));
vi.mock("../app/actions/white-label-publication", () => ({ preflightWhiteLabelPublicationAction: actions.preflight, publishWhiteLabelDraftAction: actions.publish, reconcileWhiteLabelPublicationAction: actions.reconcile }));
import { WhiteLabelPublicationControls } from "../components/white-label/white-label-publication-controls";

const actorId = "f0000000-0000-4000-8000-000000004201";
const tenantId = "f0000000-0000-4000-8000-000000004202";
const draft: WhiteLabelDraft = { tenantId, tenantStatus: "active", revision: 3, updatedAt: "2026-10-15T00:00:00Z", state: { displayName: "Agency A", primaryColor: "#000d51", accentColor: "#a8832e", modules: modulesFromKeys(["services"]) } };
const input: PublishWhiteLabelInput = { tenantId, sourceDraftRevision: 3, expectedPublicationRevision: 0, requestId: "f0000000-0000-4000-8000-000000004203", reason: "Reviewed saved branding" };
const preflight: PublicationPreflight = { tenantId, sourceDraftRevision: 3, currentDraftRevision: 3, expectedPublicationRevision: 0, currentPublicationRevision: 0, candidate: { displayName: "Agency A", primaryColor: "#000d51", accentColor: "#a8832e", moduleKeys: ["services"] }, publishable: true, blockers: [] };
const receipt: PublicationReceipt = { configuration: { tenantId, sourceDraftRevision: 3, publicationRevision: 1, displayName: "Agency A", primaryColor: "#000d51", accentColor: "#a8832e", moduleKeys: ["services"], publishedAt: "2026-10-15T01:00:00Z" }, requestId: input.requestId, expectedPublicationRevision: 0, publishedBy: actorId, reason: input.reason };
const props = { actorId, draft, hasChanges: false, draftValid: true, busy: false, onConfirmed: vi.fn(), onReload: vi.fn() };
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); actions.preflight.mockResolvedValue({ ok: true, data: preflight }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const check = () => fireEvent.click(screen.getByRole("button", { name: "Check publication eligibility" }));
async function openPublish() {
  check();
  await screen.findByText("The saved draft passed advisory preflight. Conditions can change before Publish.");
  fireEvent.change(screen.getByLabelText("Publication reason"), { target: { value: input.reason } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Publish saved draft" }));
  await screen.findByRole("dialog", { name: "Publish saved draft" });
}

describe("saved-draft publication controls", () => {
  it("requires a saved clean revision and invalidates advisory success on dirty edits, including undo", async () => {
    const view = render(<WhiteLabelPublicationControls {...props} />);
    check();
    await screen.findByText("The saved draft passed advisory preflight. Conditions can change before Publish.");
    view.rerender(<WhiteLabelPublicationControls {...props} hasChanges />);
    await waitFor(() => expect(screen.queryByText(/passed advisory preflight/)).not.toBeInTheDocument());
    view.rerender(<WhiteLabelPublicationControls {...props} />);
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    expect(actions.publish).not.toHaveBeenCalled();
    view.rerender(<WhiteLabelPublicationControls {...props} draft={{ ...draft, revision: 0 }} />);
    expect(screen.getByRole("button", { name: "Check publication eligibility" })).toBeDisabled();
  });
  it("discovers a stale publication revision without treating that advisory response as approval", async () => {
    actions.preflight.mockResolvedValueOnce({ ok: true, data: { ...preflight, currentPublicationRevision: 2, publishable: false, blockers: [{ code: "STALE_PUBLICATION" }] } });
    render(<WhiteLabelPublicationControls {...props} />);
    check();
    await screen.findByRole("button", { name: "Recheck current publication revision" });
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    actions.preflight.mockResolvedValue({ ok: true, data: { ...preflight, expectedPublicationRevision: 2, currentPublicationRevision: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Recheck current publication revision" }));
    await screen.findByText("The saved draft passed advisory preflight. Conditions can change before Publish.");
    expect(actions.preflight).toHaveBeenLastCalledWith(actorId, { tenantId, sourceDraftRevision: 3, expectedPublicationRevision: 2 });
    expect(actions.publish).not.toHaveBeenCalled();
  });
  it("does not infer eligibility from a valid Services-OFF saved draft", async () => {
    actions.preflight.mockResolvedValue({ ok: true, data: { ...preflight, candidate: { ...preflight.candidate, moduleKeys: [] }, publishable: false, blockers: [{ code: "SERVICES_REQUIRED" }] } });
    render(<WhiteLabelPublicationControls {...props} draft={{ ...draft, state: { ...draft.state, modules: modulesFromKeys([]) } }} />);
    check();
    await screen.findByText("Services is required for publication. Enable it explicitly and save a new draft.");
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    expect(actions.publish).not.toHaveBeenCalled();
  });
  it("retains the complete durable input before publish, survives remount, and reconciles before same-ID retry", async () => {
    actions.publish.mockImplementation(async (_actor, submitted) => { expect(readPublicationIntent(sessionStorage, actorId, tenantId)).toEqual(submitted); throw new Error("Lost response"); });
    const view = render(<WhiteLabelPublicationControls {...props} />);
    await openPublish();
    fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
    await screen.findByText("Publication outcome unknown. Reconcile the retained request before any retry.");
    const retained = actions.publish.mock.calls[0]![1] as PublishWhiteLabelInput;
    view.unmount();
    render(<WhiteLabelPublicationControls {...props} draft={{ ...draft, revision: 4 }} />);
    await screen.findByRole("button", { name: "Reconcile publication outcome" });
    expect(screen.queryByRole("button", { name: "Retry original publication request" })).not.toBeInTheDocument();
    actions.reconcile.mockResolvedValue({ ok: true, data: { outcome: "not_found" } });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile publication outcome" }));
    await screen.findByRole("button", { name: "Retry original publication request" });
    expect(actions.reconcile).toHaveBeenCalledWith(actorId, retained);
    expect(readPublicationIntent(sessionStorage, actorId, tenantId)).toEqual(retained);
    fireEvent.click(screen.getByRole("button", { name: "Retry original publication request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm publication" }));
    await waitFor(() => expect(actions.publish).toHaveBeenCalledTimes(2));
    expect(actions.publish.mock.calls[1]![1]).toEqual(retained);
    expect(retained.sourceDraftRevision).toBe(3);
  });
  it("does not reveal or reuse another actor or Tenant's intent", async () => {
    storePublicationIntent(sessionStorage, actorId, input);
    const view = render(<WhiteLabelPublicationControls {...props} />);
    await screen.findByRole("button", { name: "Reconcile publication outcome" });
    view.rerender(<WhiteLabelPublicationControls {...props} actorId="f0000000-0000-4000-8000-000000004204" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reconcile publication outcome" })).not.toBeInTheDocument());
    expect(screen.queryByText(input.reason)).not.toBeInTheDocument();
    view.rerender(<WhiteLabelPublicationControls {...props} draft={{ ...draft, tenantId: "f0000000-0000-4000-8000-000000004205" }} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reconcile publication outcome" })).not.toBeInTheDocument());
    expect(readPublicationIntent(sessionStorage, actorId, tenantId)).toEqual(input);
  });
  it("fails closed on malformed recovery instead of discarding it", async () => {
    sessionStorage.setItem(`wf:publication-intent:v1:${actorId}:${tenantId}`, "not JSON");
    render(<WhiteLabelPublicationControls {...props} />);
    await screen.findByText(/Publication recovery is unavailable or invalid/);
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    expect(sessionStorage.getItem(`wf:publication-intent:v1:${actorId}:${tenantId}`)).toBe("not JSON");
    expect(actions.publish).not.toHaveBeenCalled();
  });
  it("blocks execution if recovery storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    render(<WhiteLabelPublicationControls {...props} />);
    await screen.findByText(/Publication recovery is unavailable or invalid/);
    expect(screen.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    expect(actions.publish).not.toHaveBeenCalled();
  });
  it("fails closed if intent persistence fails at the final confirmation boundary", async () => {
    render(<WhiteLabelPublicationControls {...props} />);
    await openPublish();
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Quota exceeded"); });
    fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
    await screen.findByText(/Publication recovery is unavailable or invalid/);
    expect(actions.publish).not.toHaveBeenCalled();
  });
  it("a committed lost-response receipt is reconciled without a second Publish call", async () => {
    actions.publish.mockRejectedValue(new Error("Response lost"));
    render(<WhiteLabelPublicationControls {...props} />);
    await openPublish();
    fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
    await screen.findByText(/Publication outcome unknown/);
    const retained = actions.publish.mock.calls[0]![1] as PublishWhiteLabelInput;
    actions.reconcile.mockResolvedValue({ ok: true, data: { outcome: "applied", receipt: { ...receipt, requestId: retained.requestId } } });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile publication outcome" }));
    await screen.findByText(/Applied request confirmed/);
    expect(actions.publish).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Retry original publication request" })).not.toBeInTheDocument();
  });
  it("redacts known authorization loss without replacing the pending request", async () => {
    storePublicationIntent(sessionStorage, actorId, input);
    actions.reconcile.mockResolvedValue({ ok: false, error: { code: "PERMISSION_DENIED", message: "Denied" } });
    render(<WhiteLabelPublicationControls {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconcile publication outcome" }));
    await screen.findByText(/Publication controls are unavailable to the current session/);
    expect(screen.queryByRole("button", { name: "Retry original publication request" })).not.toBeInTheDocument();
    expect(readPublicationIntent(sessionStorage, actorId, tenantId)).toEqual(input);
  });
  it("keeps failed reconciliation unknown and a confirmed receipt separate from effective state", async () => {
    storePublicationIntent(sessionStorage, actorId, input);
    actions.reconcile.mockRejectedValueOnce(new Error("Unavailable"));
    render(<WhiteLabelPublicationControls {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconcile publication outcome" }));
    await screen.findByText(/original request remains unresolved/);
    expect(screen.queryByRole("button", { name: "Retry original publication request" })).not.toBeInTheDocument();
    actions.reconcile.mockResolvedValue({ ok: true, data: { outcome: "applied", receipt } });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile publication outcome" }));
    await screen.findByText("This immutable receipt is historical until current publication state is checked.");
    expect(props.onConfirmed).toHaveBeenCalledOnce();
    actions.preflight.mockResolvedValue({ ok: true, data: { ...preflight, expectedPublicationRevision: 1, currentPublicationRevision: 2, publishable: false, blockers: [{ code: "STALE_PUBLICATION" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Check current publication" }));
    await screen.findByText("Historical receipt. Publication revision 2 was current at the last check.");
  });
});

describe("publication intent recovery boundary", () => {
  it("blocks unavailable storage and refuses replacement of any pending request", () => {
    const unavailable = { getItem: () => { throw new Error("Storage unavailable"); } } as unknown as Storage;
    expect(() => readPublicationIntent(unavailable, actorId, tenantId)).toThrow();
    expect(() => storePublicationIntent(unavailable, actorId, input)).toThrow();
    storePublicationIntent(sessionStorage, actorId, input);
    expect(() => storePublicationIntent(sessionStorage, actorId, { ...input, requestId: "f0000000-0000-4000-8000-000000004206" })).toThrow();
    expect(readPublicationIntent(sessionStorage, actorId, tenantId)).toEqual(input);
  });
});

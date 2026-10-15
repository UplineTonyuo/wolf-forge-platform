// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WhiteLabelDraftReview } from "../components/white-label/white-label-draft-review";
import { modulesFromKeys, type WhiteLabelDraft } from "../domain/white-label/draft";

afterEach(cleanup);
const draft: WhiteLabelDraft = { tenantId: "f0000000-0000-4000-8000-000000004101", tenantStatus: "active", revision: 1,
  updatedAt: "2026-10-15T00:00:00Z", state: { displayName: "Northwind", primaryColor: "#14213d", accentColor: "#fca311", modules: modulesFromKeys(["services"]) } };
function review(keys: string[], hasChanges = false, displayName = "Northwind") {
  const onSave = vi.fn();
  const state = { ...draft.state, displayName, modules: modulesFromKeys(keys) };
  render(<WhiteLabelDraftReview draft={draft} state={state} hasChanges={hasChanges} busy={false} onBack={vi.fn()} onSave={onSave} canSave />);
  return { state, onSave };
}
describe("static draft versus publication notice", () => {
  it("keeps an empty draft saveable and reports required Services without changing selection", () => {
    const { state } = review([]);
    expect(screen.getByText("Draft valid. Not publishable: Services is required. Enable Services explicitly and save a new draft.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save reviewed draft" })).toBeEnabled();
    expect(Object.values(state.modules).some(Boolean)).toBe(false);
    expect(screen.queryByRole("button", { name: /^Publish/ })).not.toBeInTheDocument();
  });
  it("does not label a supported selection live-publishable", () => {
    review(["services"]);
    expect(screen.getByText("Publication eligibility has not been checked.")).toBeInTheDocument();
  });
  it("requires an explicit save for unsaved changes", () => {
    review(["services"], true);
    expect(screen.getByText("Publication eligibility has not been checked. Save this draft before requesting a publication check.")).toBeInTheDocument();
  });
  it("distinguishes invalid drafts from static publication dependency refusal", () => {
    review(["services"], false, "");
    expect(screen.getByText("Fix the draft validation issues before checking publication eligibility.")).toBeInTheDocument();
    cleanup();
    review(["services", "projects"]);
    expect(screen.getByText("Draft valid. Not publishable: selected modules do not meet publication dependencies.")).toBeInTheDocument();
  });
});

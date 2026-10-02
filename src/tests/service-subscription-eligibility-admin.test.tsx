/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  bulk: vi.fn(),
  canEdit: true,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({
    actor: { id: "actor-1" },
    user: { services: { edit: mocks.canEdit } },
    services: {
      permissions: { requireModuleAccess: async () => undefined },
      catalog: { update: mocks.update, setFolderSubscriptionEligibility: mocks.bulk },
    },
  }),
}));

const { updateServiceAction, setFolderSubscriptionEligibilityAction } = await import("../app/actions/services");
const { FolderSubscriptionControl } = await import("../components/services/folder-subscription-control");
const { folderSubscriptionSummary } = await import("../components/services/folder-subscription-summary");
const { updateServiceSchema } = await import("../domain/services/schema");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});
beforeEach(() => {
  mocks.update.mockReset().mockResolvedValue({ id: "svc" });
  mocks.bulk.mockReset().mockResolvedValue(1);
  mocks.canEdit = true;
});
afterEach(cleanup);

const active = (subscription_eligible: boolean) => ({ subscription_eligible, is_active: true, archived_at: null });

function serviceForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Franchise in a Box System", price: "100", currency: "USD", sort_order: "0", is_public: "on", ...fields })) {
    form.set(key, value);
  }
  return form;
}

async function redirectOf(promise: Promise<unknown>) {
  try {
    return await promise;
  } catch (error) {
    return (error as { url?: string }).url;
  }
}

describe("service-level subscription toggle", () => {
  it("saves the toggle on and off without touching recurring or Store visibility", async () => {
    await redirectOf(updateServiceAction("svc", { error: null }, serviceForm({ subscription_eligible: "on" })));
    expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ subscription_eligible: true, recurring: false, is_public: true });

    await redirectOf(updateServiceAction("svc", { error: null }, serviceForm({})));
    expect(mocks.update.mock.calls[1]?.[1]).toMatchObject({ subscription_eligible: false, recurring: false, is_public: true });
  });

  it("is a valid service patch field", () => {
    expect(updateServiceSchema.parse({ subscription_eligible: true })).toEqual({ subscription_eligible: true });
  });

  it("refuses users without Services edit permission", async () => {
    mocks.canEdit = false;
    expect(await updateServiceAction("svc", { error: null }, serviceForm({ subscription_eligible: "on" }))).toEqual({
      error: "You do not have permission to edit Services.",
    });
    expect(await setFolderSubscriptionEligibilityAction("folder", true, { error: null }, new FormData())).toEqual({
      error: "You do not have permission to edit Services.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.bulk).not.toHaveBeenCalled();
  });
});

describe("folder bulk control", () => {
  it("derives NONE, ALL and MIXED from active children only", () => {
    expect(folderSubscriptionSummary([active(false), active(false)]).state).toBe("none");
    expect(folderSubscriptionSummary([active(true), active(true)]).state).toBe("all");
    expect(folderSubscriptionSummary([active(true), active(false)])).toEqual({ eligible: 1, total: 2, state: "mixed" });
    expect(
      folderSubscriptionSummary([
        active(true),
        { subscription_eligible: false, is_active: false, archived_at: null },
        { subscription_eligible: false, is_active: true, archived_at: "2026-01-01" },
      ]).state,
    ).toBe("all");
  });

  it("shows a mixed folder as indeterminate with both bulk actions", () => {
    render(<FolderSubscriptionControl folderId="local" folderName="Local SEO" services={[...Array(6).fill(active(true)), active(false)]} />);
    expect(screen.getByText("6 of 7 services available for subscriptions")).toBeInTheDocument();
    expect((document.querySelector("input[type=checkbox]") as HTMLInputElement).indeterminate).toBe(true);
    expect(screen.getByRole("button", { name: "Mark all services subscription eligible" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove all services from subscriptions" })).toBeEnabled();
  });

  it("disables the action that would change nothing", () => {
    render(<FolderSubscriptionControl folderId="local" folderName="Local SEO" services={[active(true), active(true)]} />);
    expect((document.querySelector("input[type=checkbox]") as HTMLInputElement).indeterminate).toBe(false);
    expect(screen.getByRole("button", { name: "Mark all services subscription eligible" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove all services from subscriptions" })).toBeEnabled();
  });

  it("confirms before a bulk change and names how many services it affects", () => {
    render(<FolderSubscriptionControl folderId="local" folderName="Local SEO" services={[...Array(6).fill(active(true)), active(false)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove all services from subscriptions" }));
    expect(screen.getByRole("heading", { name: "Remove all services from subscriptions?" })).toBeInTheDocument();
    expect(screen.getByText(/6 services in Local SEO will no longer be selectable/)).toBeInTheDocument();
    expect(mocks.bulk).not.toHaveBeenCalled();
  });

  it("bulk action writes through the catalog service for the folder", async () => {
    expect(await redirectOf(setFolderSubscriptionEligibilityAction("local", true, { error: null }, new FormData()))).toBe(
      "/services/folders/local?subscriptions=on",
    );
    expect(mocks.bulk).toHaveBeenCalledWith("local", true, { id: "actor-1" });
    await redirectOf(setFolderSubscriptionEligibilityAction("local", false, { error: null }, new FormData()));
    expect(mocks.bulk).toHaveBeenLastCalledWith("local", false, { id: "actor-1" });
  });
});

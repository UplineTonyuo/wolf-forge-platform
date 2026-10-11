/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { gate, quickAccess, notFound, requireModuleAccess, isPlatformAdmin, listTenants, getDraft } = vi.hoisted(() => ({
  gate: vi.fn(),
  quickAccess: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireModuleAccess: vi.fn(),
  isPlatformAdmin: vi.fn(),
  listTenants: vi.fn(),
  getDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/white-label",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound,
  redirect: vi.fn(),
}));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: gate, isLocalQuickAccessSession: quickAccess }));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({
    client: {},
    services: { permissions: { requireModuleAccess, isPlatformAdmin }, whiteLabel: { listTenants, getDraft } },
  }),
}));
vi.mock("../app/actions/white-label", () => ({ getWhiteLabelDraftAction: vi.fn(), saveWhiteLabelDraftAction: vi.fn() }));

import SettingsLayout from "../app/(internal)/settings/layout";
import WhiteLabelSettingsPage from "../app/(internal)/settings/white-label/page";
import { SettingsNavigation } from "../components/settings/settings-navigation";
import { WhiteLabelBuilder } from "../components/white-label/white-label-builder";
import {
  SYNTHETIC_PREVIEW_STATE,
  WHITE_LABEL_MODULES,
  contrastWithWhite,
  moduleAvailable,
  normalizeHexColor,
  previewNavigationModules,
  type WhiteLabelPreviewState,
} from "../domain/white-label/preview";

function Builder({ readOnly = false }: { readOnly?: boolean }) {
  const [state, setState] = useState<WhiteLabelPreviewState>(SYNTHETIC_PREVIEW_STATE);
  return <WhiteLabelBuilder state={state} onStateChange={setState} readOnly={readOnly} />;
}

const noSearch = { searchParams: Promise.resolve({}) };

const TENANT_B = {
  id: "f0f0f0f0-0000-4000-8000-000000002601",
  slug: "tenant-b",
  displayName: "Tenant B",
  status: "active" as const,
  draftRevision: 3,
};
const DRAFT_B = {
  tenantId: TENANT_B.id,
  tenantStatus: "active" as const,
  state: { ...SYNTHETIC_PREVIEW_STATE, displayName: "Bravo Draft" },
  revision: 3,
  updatedAt: "2026-10-09T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function previewEntry(id: string): HTMLElement {
  return document.querySelector(`[data-module="${id}"]`) as HTMLElement;
}

function shown(id: string): boolean {
  return previewEntry(id).getAttribute("data-shown") === "true";
}

describe("White Label preview domain", () => {
  it("defines the approved recommendation and starting selection for all nine modules", () => {
    expect(WHITE_LABEL_MODULES.map(({ id, recommendation, defaultEnabled }) => [id, recommendation, defaultEnabled])).toEqual([
      ["services", "recommended", true], ["projects", "recommended", true], ["tickets", "recommended", true],
      ["reporting", "recommended", true], ["invoices", "recommended", true], ["subscriptions", "specialized", false],
      ["coupons", "not_recommended", false], ["investment_intent", "not_recommended", false], ["forms", "recommended", true],
    ]);
    expect(WHITE_LABEL_MODULES.every((module) => module.recommendationLabel && module.description)).toBe(true);
  });
  it("never offers or shows Operations", () => {
    expect(WHITE_LABEL_MODULES.map(({ id }) => id)).not.toContain("todo");
    expect(previewNavigationModules({ ...SYNTHETIC_PREVIEW_STATE.modules, todo: true }).todo).toBe(false);
  });

  it("hides a module whose required module is off", () => {
    const modules = { ...SYNTHETIC_PREVIEW_STATE.modules, services: false };
    for (const id of ["projects", "subscriptions", "coupons", "investment_intent"]) {
      expect(moduleAvailable(modules, id)).toBe(false);
    }
    expect(moduleAvailable(modules, "tickets")).toBe(true);
    expect(previewNavigationModules(modules)).toMatchObject({ dashboard: true, clients: true, settings: true });
  });

  it("accepts only six-digit hex colors and computes contrast", () => {
    expect(normalizeHexColor("#ABCDEF", "#000000")).toBe("#abcdef");
    expect(normalizeHexColor("red; background:url(x)", "#000000")).toBe("#000000");
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("White Label builder", () => {
  it("starts with six choices and lets every non-default module be selected in both previews", () => {
    render(<Builder />);
    expect(screen.getAllByRole("checkbox").filter((entry) => (entry as HTMLInputElement).checked)).toHaveLength(6);
    for (const label of ["Subscriptions", "Coupons", "Investment Intent"]) {
      const checkbox = screen.getByRole("checkbox", { name: label });
      expect(checkbox).not.toBeChecked();
      expect(checkbox).toHaveAccessibleDescription(/Enable/);
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    }
    for (const id of ["subscriptions", "coupons", "investment_intent"]) expect(shown(id)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    for (const id of ["subscriptions", "coupons", "investment_intent"]) expect(shown(id)).toBe(true);
    expect(screen.getByText(/Reporting, Investment Intent, Projects, Tickets, Subscriptions and Invoices are optional for publication/)).toBeInTheDocument();
    expect(screen.getByText(/Invoices can be disabled only with Subscriptions OFF and no outstanding or pending financial obligations, including archived obligations/)).toBeInTheDocument();
    expect(screen.getByText(/Refund ledger entries do not confirm returned money/)).toBeInTheDocument();
    expect(screen.getByText(/Published Projects requires Tickets/)).toBeInTheDocument();
    expect(screen.getByText(/Archived unresolved Tickets stay in history and are inaccessible/)).toBeInTheDocument();
  });
  it("toggling a module updates the preview navigation, honouring dependencies", () => {
    render(<Builder />);
    expect(shown("tickets")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Tickets/ }));
    expect(shown("tickets")).toBe(false);
    expect(previewEntry("tickets")).toHaveAttribute("aria-hidden", "true");

    for (const label of ["Subscriptions", "Coupons", "Investment Intent"]) fireEvent.click(screen.getByRole("checkbox", { name: label }));

    fireEvent.click(screen.getByRole("checkbox", { name: /^Services/ }));
    expect(shown("projects")).toBe(false);
    expect(screen.getByRole("checkbox", { name: /Projects/ })).toBeChecked();
    expect(screen.getAllByText("Hidden until Services is on.").length).toBe(4);

    fireEvent.click(screen.getByRole("checkbox", { name: /^Services/ }));
    expect(shown("projects")).toBe(true);
  });

  it("never renders Operations and keeps core modules visible", () => {
    render(<Builder />);
    expect(previewEntry("todo")).toBeNull();
    expect(screen.queryByText("Operations", { selector: "span" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Operations/ })).toBeNull();
    for (const id of ["dashboard", "clients", "team", "settings"]) expect(shown(id)).toBe(true);
  });

  it("appearance changes update the preview colors and warn on low contrast", () => {
    render(<Builder />);
    const frame = screen.getByTestId("preview-frame");
    fireEvent.change(screen.getByLabelText(/Accent color/), { target: { value: "#22aa55" } });
    expect(frame.style.getPropertyValue("--preview-accent")).toBe("#22aa55");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(frame.style.getPropertyValue("--preview-on-accent")).toBe("var(--wf-navy)");
    fireEvent.change(screen.getByLabelText(/Accent color/), { target: { value: "#7a1030" } });
    expect(frame.style.getPropertyValue("--preview-on-accent")).toBe("#fff");
    fireEvent.change(screen.getByLabelText(/Primary color/), { target: { value: "#f0f0f0" } });
    expect(frame.style.getPropertyValue("--preview-primary")).toBe("#f0f0f0");
    expect(screen.getByRole("status")).toHaveTextContent(/hard to read/);
  });

  it("the display name updates the preview", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Workspace display name"), { target: { value: "Acme Labs" } });
    expect(screen.getByTestId("preview-brand-name")).toHaveTextContent("Acme Labs");
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to Acme Labs");
  });

  it("switching device keeps the same configuration", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Workspace display name"), { target: { value: "Acme Labs" } });
    fireEvent.change(screen.getByLabelText(/Primary color/), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoices/ }));

    const mobile = screen.getByRole("button", { name: "Mobile" });
    fireEvent.click(mobile);
    expect(mobile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("preview-frame")).toHaveAttribute("data-device", "mobile");
    expect(screen.getByTestId("preview-brand-name")).toHaveTextContent("Acme Labs");
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--preview-primary")).toBe("#123456");
    expect(shown("invoices")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(screen.getByTestId("preview-brand-name")).toHaveTextContent("Acme Labs");
    expect(shown("invoices")).toBe(false);
  });

  it("is labelled and the builder itself offers no save or publish action", () => {
    render(<Builder />);
    const form = screen.getByRole("form", { name: "White Label preview settings" });
    for (const legend of ["Identity", "Appearance", "Modules"]) {
      expect(within(form).getByRole("group", { name: legend })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Preview device" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Preview navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Preview navigation" })).toBeNull();
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Desktop", "Mobile"]);
  });

  it("read-only disables every control but keeps the preview", () => {
    render(<Builder readOnly />);
    for (const legend of ["Identity", "Appearance", "Modules"]) {
      expect(screen.getByRole("group", { name: legend })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Mobile" })).toBeEnabled();
  });

  it("builder source performs no network or database call", () => {
    for (const file of ["../components/white-label/white-label-builder.tsx", "../domain/white-label/preview.ts"]) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/fetch\(|supabase|\.rpc\(|localStorage|"use server"/i);
    }
  });
});

describe("White Label route and Settings entry", () => {
  it("the page does not exist outside the local QA gate, even for a Platform Admin", async () => {
    gate.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    await expect(WhiteLabelSettingsPage(noSearch)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireModuleAccess).not.toHaveBeenCalled();
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it("inside the gate a Settings-capable Tenant owner without the entitlement gets notFound", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    requireModuleAccess.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(false);
    await expect(WhiteLabelSettingsPage(noSearch)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(isPlatformAdmin).toHaveBeenCalledOnce();
    expect(listTenants).not.toHaveBeenCalled();
  });

  it("inside the gate a Platform Admin gets the Tenant selector and no draft until a Tenant is chosen", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    requireModuleAccess.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(true);
    listTenants.mockResolvedValue([TENANT_B]);
    render(await WhiteLabelSettingsPage(noSearch));
    expect(screen.getByText("Choose a Tenant")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "White Label preview settings" })).toBeNull();
    expect(getDraft).not.toHaveBeenCalled();
  });

  it("?tenant= opens that Tenant's draft only when it is a listed Tenant", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    requireModuleAccess.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(true);
    listTenants.mockResolvedValue([TENANT_B]);
    getDraft.mockResolvedValue(DRAFT_B);
    render(await WhiteLabelSettingsPage({ searchParams: Promise.resolve({ tenant: TENANT_B.id }) }));
    expect(getDraft).toHaveBeenCalledExactlyOnceWith(TENANT_B.id);
    expect(screen.getByLabelText("Workspace display name")).toHaveValue("Bravo Draft");
    cleanup();

    getDraft.mockClear();
    render(await WhiteLabelSettingsPage({ searchParams: Promise.resolve({ tenant: "11111111-1111-4111-8111-111111111111" }) }));
    expect(getDraft).not.toHaveBeenCalled();
  });

  it("inside the gate the passwordless Quick Access session gets notFound even with the entitlement", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(true);
    requireModuleAccess.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(true);
    await expect(WhiteLabelSettingsPage(noSearch)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listTenants).not.toHaveBeenCalled();
  });

  it("inside the gate the page still requires Settings access", async () => {
    gate.mockResolvedValue(true);
    requireModuleAccess.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    await expect(WhiteLabelSettingsPage(noSearch)).rejects.toThrow("PERMISSION_DENIED");
    expect(requireModuleAccess).toHaveBeenCalledWith("settings");
  });

  it("the Settings entry shows only when the layout enables it", () => {
    const { unmount } = render(<SettingsNavigation />);
    expect(screen.queryByRole("link", { name: "White Label" })).toBeNull();
    unmount();
    render(<SettingsNavigation showWhiteLabel />);
    const link = screen.getByRole("link", { name: "White Label" });
    expect(link).toHaveAttribute("href", "/settings/white-label");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/settings/general");
  });

  async function layoutShowsWhiteLabel(): Promise<boolean> {
    // SettingsLayout -> div -> PageFrame -> SettingsShell
    const tree = (await SettingsLayout({ children: null })) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement<{ showWhiteLabel: boolean }> }> }>;
    return tree.props.children.props.children.props.showWhiteLabel;
  }

  it("the Settings layout shows the entry only for the local QA gate AND a Platform Admin", async () => {
    requireModuleAccess.mockResolvedValue(true);

    gate.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    expect(await layoutShowsWhiteLabel()).toBe(false);
    expect(isPlatformAdmin).not.toHaveBeenCalled();

    gate.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(false);
    expect(await layoutShowsWhiteLabel()).toBe(false);

    isPlatformAdmin.mockRejectedValue(new Error("DATABASE_ERROR"));
    expect(await layoutShowsWhiteLabel()).toBe(false);

    isPlatformAdmin.mockResolvedValue(true);
    expect(await layoutShowsWhiteLabel()).toBe(true);
  });
});

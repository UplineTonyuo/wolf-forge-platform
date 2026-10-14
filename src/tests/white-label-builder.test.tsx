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
vi.mock("../app/actions/white-label", () => ({ getWhiteLabelDraftAction: vi.fn(), saveWhiteLabelDraftAction: vi.fn(), listWhiteLabelDraftsAction: vi.fn(() => new Promise(() => {})) }));

import WhiteLabelSettingsPage from "../app/(internal)/white-label/page";
import LegacyWhiteLabelPage from "../app/(internal)/settings/white-label/page";
import { redirect } from "next/navigation";
import { navigationForModules, activeNavigationRoute } from "../components/shell/nav-registry";
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

/** Normal mode omits excluded modules entirely; edit mode keeps them as faded rows. */
function shown(id: string): boolean {
  return previewEntry(id)?.getAttribute("data-shown") === "true";
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

const live = () => within(screen.getByRole("region", { name: "Live preview" }));
// X/+ controls exist only in the preview sidebar's transient edit mode.
const editModules = () => { const edit = live().queryByRole("button", { name: "Edit modules" }); if (edit) fireEvent.click(edit); };
const moduleSwitch = (label: string) => { editModules(); return live().getByRole("switch", { name: `${label} module` }); };
const selectedModules = () => (editModules(), live().getAllByRole("switch")).filter((entry) => entry.getAttribute("aria-checked") === "true");

describe("White Label builder", () => {
  it("measures the newly mounted phone when switching from Desktop to Mobile", () => {
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; unobserve = vi.fn(); });
    const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(280);
    try {
      render(<Builder />);
      expect(observe).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
      expect(Number(screen.getByTestId("preview-frame").style.zoom)).toBeCloseTo(280 / 413);
      expect(observe).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      width.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("starts with six choices and lets every non-default module be added in both previews", () => {
    render(<Builder />);
    expect(selectedModules()).toHaveLength(6);
    for (const label of ["Subscriptions", "Coupons", "Investment Intent"]) {
      const control = moduleSwitch(label);
      expect(control).toHaveAttribute("aria-checked", "false");
      fireEvent.click(control);
      expect(control).toHaveAttribute("aria-checked", "true");
    }
    for (const id of ["subscriptions", "coupons", "investment_intent"]) expect(shown(id)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    for (const id of ["subscriptions", "coupons", "investment_intent"]) expect(shown(id)).toBe(true);
    expect(screen.getByText(/Publishing, live branding, live module changes and tenant provisioning are unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/A valid draft is not a publication approval/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
  });
  it("X/+ controls update the draft in place and ghost disabled rows without moving them", () => {
    render(<Builder />);
    const order = () => [...document.querySelectorAll("[data-module]")].map((entry) => entry.getAttribute("data-module"));
    editModules();
    const before = order();
    expect(shown("tickets")).toBe(true);
    fireEvent.click(moduleSwitch("Tickets"));
    expect(shown("tickets")).toBe(false);
    expect(previewEntry("tickets").querySelector("button")).toBeDisabled();
    expect(moduleSwitch("Tickets")).toHaveAttribute("aria-checked", "false");
    expect(live().getByRole("status")).toHaveTextContent("Tickets removed from the draft");
    expect(order()).toEqual(before);
    fireEvent.click(moduleSwitch("Tickets"));
    expect(shown("tickets")).toBe(true);
    expect(order()).toEqual(before);
  });
  it("desktop normal mode hides X/+ and omits excluded modules; edit mode shows all nine in order", () => {
    render(<Builder />);
    const configurable = () => [...document.querySelectorAll("[data-module]")].map((entry) => entry.getAttribute("data-module")).filter((id) => WHITE_LABEL_MODULES.some((module) => module.id === id));
    expect(live().queryAllByRole("switch")).toHaveLength(0);
    for (const id of ["subscriptions", "coupons", "investment_intent"]) expect(previewEntry(id)).toBeNull();
    expect(configurable()).toEqual(["projects", "tickets", "reporting", "invoices", "services", "forms"]);
    const edit = live().getByRole("button", { name: "Edit modules" });
    fireEvent.click(edit);
    expect(edit).toHaveAttribute("aria-pressed", "true");
    expect(edit).toHaveTextContent("Done");
    expect(configurable()).toEqual(["projects", "tickets", "reporting", "invoices", "subscriptions", "coupons", "investment_intent", "services", "forms"]);
    for (const id of ["subscriptions", "coupons", "investment_intent"]) {
      expect(previewEntry(id)).toHaveAttribute("data-enabled", "false");
      expect(previewEntry(id).querySelector("button")).toBeDisabled();
      expect(previewEntry(id).querySelector('[role="switch"]')).toHaveAttribute("aria-checked", "false");
    }
    for (const id of ["dashboard", "clients", "team", "team_supervision", "settings"]) expect(previewEntry(id).querySelector('[role="switch"]')).toBeNull();
    fireEvent.click(moduleSwitch("Coupons"));
    fireEvent.click(live().getByRole("button", { name: "Done" }));
    expect(live().queryAllByRole("switch")).toHaveLength(0);
    expect(shown("coupons")).toBe(true);
    expect(previewEntry("subscriptions")).toBeNull();
  });
  it("Escape leaves desktop edit mode and returns focus to Edit modules", () => {
    render(<Builder />);
    editModules();
    fireEvent.keyDown(moduleSwitch("Forms"), { key: "Escape" });
    expect(live().queryAllByRole("switch")).toHaveLength(0);
    expect(live().getByRole("button", { name: "Edit modules" })).toHaveFocus();
  });
  it("removing the module being previewed returns the preview to Dashboard", () => {
    render(<Builder />);
    fireEvent.click(live().getByRole("button", { name: "Open Reporting preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Reporting");
    fireEvent.click(moduleSwitch("Reporting"));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to");
    fireEvent.click(moduleSwitch("Reporting"));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to");
  });
  it("blocks dependency-breaking changes, explains why and keeps the previous state", () => {
    render(<Builder />);
    fireEvent.click(moduleSwitch("Services"));
    expect(moduleSwitch("Services")).toHaveAttribute("aria-checked", "true");
    expect(shown("projects")).toBe(true);
    expect(live().getByRole("status")).toHaveTextContent("Projects needs Services. Remove it first.");
    fireEvent.click(moduleSwitch("Projects"));
    fireEvent.click(moduleSwitch("Services"));
    expect(moduleSwitch("Services")).toHaveAttribute("aria-checked", "false");
    for (const id of ["services", "projects"]) expect(shown(id)).toBe(false);
    fireEvent.click(moduleSwitch("Subscriptions"));
    expect(moduleSwitch("Subscriptions")).toHaveAttribute("aria-checked", "false");
    expect(live().getByRole("status")).toHaveTextContent("Subscriptions needs Services. Add Services first.");
    fireEvent.click(moduleSwitch("Services"));
    fireEvent.click(moduleSwitch("Subscriptions"));
    expect(shown("subscriptions")).toBe(true);
  });
  it("offers controls only on the nine configurable modules", () => {
    render(<Builder />);
    editModules();
    expect(live().getAllByRole("switch")).toHaveLength(9);
    for (const id of ["dashboard", "clients", "team", "team_supervision", "settings"]) expect(previewEntry(id).querySelector('[role="switch"]')).toBeNull();
  });
  it("mobile navigation edits modules only in edit mode", () => {
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    fireEvent.click(live().getByRole("button", { name: "Open preview navigation" }));
    expect(live().queryAllByRole("switch")).toHaveLength(0);
    fireEvent.click(live().getByRole("button", { name: "Edit modules" }));
    fireEvent.click(moduleSwitch("Forms"));
    expect(shown("forms")).toBe(false);
    fireEvent.keyDown(live().getByRole("button", { name: "Close preview navigation" }), { key: "Escape" });
    expect(live().getByRole("button", { name: "Open preview navigation" })).toHaveFocus();
  });

  it("never renders Operations and keeps core modules visible", () => {
    render(<Builder />);
    expect(previewEntry("todo")).toBeNull();
    expect(screen.queryByText("Operations", { selector: "span" })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Operations/ })).toBeNull();
    for (const id of ["dashboard", "clients", "team", "settings"]) expect(shown(id)).toBe(true);
  });

  it("appearance changes update the preview colors and warn on low contrast", () => {
    render(<Builder />);
    const frame = screen.getByTestId("preview-frame");
    const colorStatus = () => within(screen.getByRole("form", { name: "White Label preview settings" })).getByRole("status");
    fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#22aa55" } });
    expect(frame.style.getPropertyValue("--preview-accent")).toBe("#22aa55");
    expect(colorStatus()).toBeEmptyDOMElement();
    expect(frame.style.getPropertyValue("--preview-on-accent")).toBe("#000d51");
    fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#7a1030" } });
    expect(frame.style.getPropertyValue("--preview-on-accent")).toBe("#ffffff");
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#f0f0f0" } });
    expect(frame.style.getPropertyValue("--preview-primary")).toBe("#f0f0f0");
    expect(colorStatus()).toHaveTextContent(/hard to read/);
  });

  it("the display name updates the preview", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Workspace display name"), { target: { value: "Acme Labs" } });
    expect(screen.getByTestId("preview-brand-name")).toHaveTextContent("Acme Labs");
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to Acme Labs");
    expect(screen.queryByText("Simulated agency workspace")).toBeNull();
  });

  it("switching device keeps the same configuration", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Workspace display name"), { target: { value: "Acme Labs" } });
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#123456" } });
    fireEvent.click(moduleSwitch("Invoices"));

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

  it("phone presets change the simulated viewport's exact CSS size", () => {
    render(<Builder />);
    expect(screen.queryByRole("button", { name: /^Phone size:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(live().getByRole("button", { name: "Phone size: iPhone 15 Pro · 393 × 852" })).toBeInTheDocument();
    for (const [name, width, height] of [["Samsung Galaxy S24", 360, 780], ["Google Pixel 9", 412, 915], ["iPhone 15 Pro", 393, 852]] as const) {
      fireEvent.click(live().getByRole("button", { name: /^Phone size:/ }));
      fireEvent.click(screen.getByRole("option", { name: `${name} · ${width} × ${height}` }));
      expect(live().getByRole("button", { name: `Phone size: ${name} · ${width} × ${height}` })).toBeInTheDocument();
      expect(screen.getByTestId("phone-viewport").style.width).toBe(`${width}px`);
      expect(screen.getByTestId("phone-viewport").style.height).toBe(`${height}px`);
    }
  });
  it("mobile mode shows one interactive phone inside Live Preview and no separate showcase", () => {
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getAllByTestId("phone-viewport")).toHaveLength(1);
    expect(live().getByTestId("phone-viewport")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mobile preview" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Phone state shown" })).toBeNull();
  });

  it("is labelled and the builder itself offers no save or publish action", () => {
    render(<Builder />);
    const form = screen.getByRole("form", { name: "White Label preview settings" });
    for (const legend of [/Workspace identity/, /Brand colors/]) {
      expect(within(form).getByRole("group", { name: legend })).toBeInTheDocument();
    }
    expect(within(form).queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("group", { name: "Preview device" })).toBeInTheDocument();
    expect(live().getByRole("group", { name: "Preview navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Preview navigation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Desktop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mobile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Draft|Publish|Activate/ })).toBeNull();
  });

  it("read-only disables every control but keeps the preview", () => {
    render(<Builder readOnly />);
    for (const legend of [/Workspace identity/, /Brand colors/]) {
      expect(screen.getByRole("group", { name: legend })).toBeDisabled();
    }
    expect(live().getByRole("button", { name: "Edit modules" })).toBeDisabled();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mobile" })).toBeEnabled();
  });

  it("builder source performs no network or database call", () => {
    for (const file of ["../components/white-label/white-label-builder.tsx", "../components/white-label/white-label-preview.tsx", "../components/white-label/white-label-color-controls.tsx", "../domain/white-label/preview.ts"]) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/fetch\(|supabase|\.rpc\(|localStorage|"use server"|useRouter|next\/link|window\.location/i);
    }
  });
});

describe("White Label route and Settings entry", () => {


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
    expect(screen.getByText("Loading Tenant drafts…")).toBeInTheDocument();
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

  it("the studio retains the original Settings boundary alongside Platform Admin authority", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    listTenants.mockResolvedValue([]);
    render(await WhiteLabelSettingsPage(noSearch));
    expect(requireModuleAccess).toHaveBeenCalledWith("settings");
    expect(screen.getByRole("heading", { name: "White Label Studio" })).toBeInTheDocument();
    requireModuleAccess.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    await expect(WhiteLabelSettingsPage(noSearch)).rejects.toThrow("PERMISSION_DENIED");
  });

  it("Settings no longer offers White Label", () => {
    render(<SettingsNavigation />);
    expect(screen.queryByRole("link", { name: "White Label" })).toBeNull();
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/settings/general");
  });

  it("legacy bookmarks redirect only after authorization and preserve a listed Tenant", async () => {
    requireModuleAccess.mockResolvedValue(true);
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    listTenants.mockResolvedValue([TENANT_B]);
    await LegacyWhiteLabelPage({ searchParams: Promise.resolve({ tenant: TENANT_B.id }) });
    expect(redirect).toHaveBeenLastCalledWith(`/white-label?tenant=${TENANT_B.id}`);
    await LegacyWhiteLabelPage({ searchParams: Promise.resolve({ tenant: "https://evil.test" }) });
    expect(redirect).toHaveBeenLastCalledWith("/white-label");
    vi.mocked(redirect).mockClear();
    isPlatformAdmin.mockResolvedValue(false);
    await expect(LegacyWhiteLabelPage(noSearch)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("Activity visibility cannot be forged with a Tenant module key", () => {
    expect(navigationForModules({ white_label: true }).flatMap((group) => group.items)).toEqual([]);
    const categories = navigationForModules({}, true);
    expect(categories).toEqual([{ id: "activity", label: "Activity", items: [{ id: "white_label", label: "White Label", route: "/white-label" }] }]);
    expect(activeNavigationRoute("/white-label")).toBe("/white-label");
    expect(previewNavigationModules({})).not.toHaveProperty("white_label");
  });
});

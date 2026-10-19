/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternalShell } from "../components/shell/internal-shell";
import { ClientAccountShell } from "../components/account/client-account-shell";
import type { ClientUser, InternalUser } from "../lib/supabase/next-server";
import type { RuntimeWhiteLabelConfiguration } from "../domain/white-label/publication";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, prefetch: vi.fn() }),
}));
vi.mock("../components/shell/workspace-command-bar", () => ({
  WorkspaceCommandBar: ({ mobileNavigation }: { mobileNavigation: ReactNode }) => mobileNavigation,
}));
vi.mock("../components/shell/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("../components/shell/wolf-forge-mark", () => ({ WolfForgeMark: () => <span data-testid="existing-wolf-mark" /> }));
vi.mock("../components/team/team-presence-provider", () => ({
  TeamPresenceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/account/command/client-command-bar", () => ({ ClientCommandBar: () => null }));
vi.mock("../components/account/command/portal-drawer", () => ({
  PortalDrawerProvider: ({ children }: { children: ReactNode }) => children,
  usePortalDrawer: () => ({ open: false, setOpen: vi.fn() }),
}));
vi.mock("../components/account/services/service-chooser-context", () => ({
  ServiceChooserProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/tickets/use-ticket-cache-revocation", () => ({ useTicketCacheRevocation: vi.fn() }));
vi.mock("../app/actions/auth", () => ({ signOutAction: vi.fn() }));

const internalUser = {
  id: "staff-a", displayName: "Staff A", avatarUrl: null, role: "staff",
  tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
  modules: { dashboard: true, settings: true }, teamMessaging: { use: false },
} as unknown as InternalUser;
const clientUser: ClientUser = {
  id: "client-a", displayName: "Client A", companyId: "company-a", companyName: "Client Company",
  modules: { portal_dashboard: true, portal_profile: true },
};
const tenantA: RuntimeWhiteLabelConfiguration = {
  kind: "published",
  configuration: {
    tenantId: internalUser.tenantId, publicationRevision: 1, sourceDraftRevision: 4,
    displayName: "Northwind Studio", primaryColor: "#173c32", accentColor: "#d2b777",
    moduleKeys: ["services", "tickets"], publishedAt: "2026-10-13T12:00:00Z",
  },
};
const tenantB: RuntimeWhiteLabelConfiguration = {
  kind: "published",
  configuration: {
    ...tenantA.configuration, tenantId: "bbbbbbbb-0000-4000-8000-000000000002",
    displayName: "Harbor Agency", primaryColor: "#ffffff", accentColor: "#111c38",
  },
};

beforeEach(() => {
  navigation.pathname = "/dashboard";
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function WorkspaceState() {
  const [saved, setSaved] = useState(false);
  return <><input aria-label="Unsaved business text" defaultValue="Keep this edit" />
    <button onClick={() => setSaved(true)}>Accept purchase</button>
    {saved ? <p>Original purchase accepted</p> : null}</>;
}

function internal(configuration: RuntimeWhiteLabelConfiguration) {
  const tenantId = configuration.kind === "published" ? configuration.configuration.tenantId : configuration.tenantId;
  return <InternalShell user={{ ...internalUser, tenantId }} runtimeConfiguration={configuration} showWhiteLabel>
    <WorkspaceState />
  </InternalShell>;
}

function portal(configuration: RuntimeWhiteLabelConfiguration) {
  return <ClientAccountShell user={clientUser} serviceCatalog={{ folders: [], services: [] }} runtimeConfiguration={configuration}>
    <WorkspaceState />
  </ClientAccountShell>;
}

describe("runtime tenant shells", () => {
  it("applies Tenant A to internal desktop and mobile while preserving the mark and module map", () => {
    const { container } = render(internal(tenantA));
    const shell = container.querySelector<HTMLElement>(".internal-app")!;
    expect(shell).toHaveAttribute("data-branding-tenant", tenantA.configuration.tenantId);
    expect(shell).toHaveAttribute("data-branding-contract", "1.0");
    expect(shell.style.getPropertyValue("--tenant-primary")).toBe("#173c32");
    expect(screen.getByLabelText("Northwind Studio")).toHaveTextContent("Northwind Studio");
    expect(screen.getByTestId("existing-wolf-mark")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tickets" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Northwind Studio navigation" });
    expect(within(dialog).getByText("Northwind Studio")).toBeInTheDocument();
    expect(document.body.style.getPropertyValue("--tenant-primary")).toBe("");
  });

  it("keeps the Platform Admin control-plane shell Wolf Forge without suppressing its ordinary tenant workspace", () => {
    const view = render(internal(tenantA));
    expect(view.container.querySelector(".tenant-workspace")).not.toBeNull();
    navigation.pathname = "/white-label";
    view.rerender(internal(tenantA));
    expect(view.container.querySelector(".tenant-workspace")).toBeNull();
    expect(screen.getByLabelText("Wolf Forge")).toBeInTheDocument();
    expect(screen.queryByText("Northwind Studio")).not.toBeInTheDocument();
    navigation.pathname = "/white-label/history";
    view.rerender(internal(tenantB));
    expect(view.container.querySelector(".tenant-workspace")).toBeNull();
    navigation.pathname = "/dashboard";
    view.rerender(internal(tenantB));
    expect(screen.getByLabelText("Harbor Agency")).toBeInTheDocument();
  });

  it.each([internal, portal])("switches tenant props and later legacy policy without preserving the previous brand", (surface) => {
    const view = render(surface(tenantA));
    view.rerender(surface(tenantB));
    const shell = view.container.querySelector<HTMLElement>(".tenant-workspace")!;
    expect(shell).toHaveAttribute("data-branding-tenant", tenantB.configuration.tenantId);
    expect(shell.style.getPropertyValue("--tenant-primary")).toBe("#ffffff");
    expect(view.container).not.toHaveTextContent("Northwind Studio");
    view.rerender(surface({ kind: "legacy_modules", tenantId: tenantB.configuration.tenantId, publicationRevision: 2, moduleKeys: ["services"] }));
    expect(view.container.querySelector(".tenant-workspace")).toBeNull();
    expect(view.container).not.toHaveTextContent("Harbor Agency");
  });

  it("applies portal workspace identity separately from the client company and person", () => {
    render(portal(tenantA));
    expect(screen.getByRole("link", { name: "Northwind Studio client portal" })).toHaveTextContent("Northwind Studio");
    expect(screen.getByText("Client Company")).toBeInTheDocument();
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
  });

  it.each([internal, portal])("retains unsaved edits and an accepted purchase on ordinary publication revision refresh", (surface) => {
    const view = render(surface(tenantA));
    fireEvent.change(screen.getByLabelText("Unsaved business text"), { target: { value: "Still unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept purchase" }));
    view.rerender(surface({ kind: "published", configuration: { ...tenantA.configuration, publicationRevision: 2, displayName: "Updated Studio" } }));
    expect(screen.getByLabelText("Unsaved business text")).toHaveValue("Still unsaved");
    expect(screen.getByText("Original purchase accepted")).toBeInTheDocument();
  });

  it.each([internal, portal])("preserves established defaults when there is no publication", (surface) => {
    const view = render(surface({ kind: "unpublished", tenantId: internalUser.tenantId, publicationRevision: 0 }));
    expect(view.container.querySelector(".tenant-workspace")).toBeNull();
    expect(screen.getByTestId("existing-wolf-mark")).toBeInTheDocument();
  });

  it("renders a published name as text without creating injected markup", () => {
    const view = render(portal({ kind: "published", configuration: { ...tenantA.configuration, displayName: "<img src=x onerror=alert(1)>" } }));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(view.container.querySelector("img[src=x]")).toBeNull();
  });

  it("refuses an internal snapshot that belongs to a different current user scope", () => {
    expect(() => render(<InternalShell user={internalUser} runtimeConfiguration={tenantB}>Content</InternalShell>)).toThrow("Workspace branding scope mismatch");
  });
});

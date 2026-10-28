/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { startTransition, use, useEffect, useState, type Context, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientAccountShell } from "../components/account/client-account-shell";
import Loading from "../app/account/loading";
import type { ClientUser } from "../lib/supabase/next-server";

const nav = vi.hoisted(() => ({ path: null as unknown as Context<string>, push: (() => {}) as (route: string) => void, redirect: null as string | null }));
vi.mock("next/navigation", async () => {
  const { createContext, useContext } = await import("react");
  nav.path = createContext("/account");
  return { usePathname: () => useContext(nav.path), useRouter: () => ({ push: (route: string) => nav.push(route) }) };
});
vi.mock("../components/account/command/client-command-bar", () => ({
  ClientCommandBar: ({ pendingRoute }: { pendingRoute?: string | null }) => <><div>Workspace controls</div><span data-testid="pending-command-title">{pendingRoute}</span></>,
}));
vi.mock("../components/account/services/service-chooser-context", () => ({ ServiceChooserProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/shell/tenant-branding-provider", () => ({
  TenantBrandingProvider: ({ children }: { children: ReactNode }) => children,
  useRuntimeBranding: () => ({ branding: null, unavailable: false }),
}));
vi.mock("../components/pwa/pwa-provider", () => ({ PwaInstallButton: () => null }));
vi.mock("../components/tickets/client-draft-provider", () => ({ ClientDraftSignOut: ({ children }: { children: ReactNode }) => children }));
vi.mock("../app/actions/auth", () => ({ signOutAction: vi.fn() }));

const user: ClientUser = {
  id: "test-client", companyId: "test-company", companyName: "Test company", displayName: "Test client",
  modules: Object.fromEntries(["dashboard", "projects", "forms", "tickets", "reporting", "store", "invoices", "subscriptions"].map((key) => [`portal_${key}`, true])),
};
const loaded = Object.assign(Promise.resolve(), { status: "fulfilled" as const, value: undefined });
let payloads: Map<string, () => void>;
let pushes: string[];
let inPageHref: string | null;

function Page({ pathname, ready }: { pathname: string; ready: Promise<void> }) {
  use(ready);
  return <><h1>Page {pathname}</h1><input aria-label="Unsent draft" defaultValue="" />{inPageHref ? <a href={inPageHref} onClick={(event) => { event.preventDefault(); nav.push(inPageHref!); }}>Open project</a> : null}</>;
}

function Router({ initial = "/account" }: { initial?: string }) {
  const [state, setState] = useState({ pathname: initial, ready: loaded as Promise<void> });
  useEffect(() => {
    nav.push = (route) => {
      pushes.push(route);
      const ready = new Promise<void>((resolve) => payloads.set(route, resolve));
      startTransition(() => setState({ pathname: nav.redirect ?? route, ready }));
    };
  }, []);
  return <nav.path.Provider value={state.pathname}>
    <ClientAccountShell user={user} serviceCatalog={{ folders: [], services: [] }}>
      <Page key={state.pathname} pathname={state.pathname} ready={state.ready} />
    </ClientAccountShell>
  </nav.path.Provider>;
}

function click(route: string, options = {}) {
  return act(async () => { fireEvent.click(document.querySelector(`.portal-nav a[href='${route}']`)!, options); });
}
function commit(route: string) { return act(async () => { payloads.get(route)!(); }); }
function active() { return document.querySelector(".portal-nav a[aria-current='page']")?.getAttribute("href"); }

beforeEach(() => { payloads = new Map(); pushes = []; nav.redirect = null; inPageHref = null; });
afterEach(cleanup);

describe("client navigation loading", () => {
  it("shows the destination immediately, retains the hidden editor, and replaces the skeleton on commit", async () => {
    render(<Router />);
    const editor = screen.getByRole("textbox", { name: "Unsent draft" });
    fireEvent.change(editor, { target: { value: "UNSENT QA draft" } });
    await click("/account/projects");
    expect(screen.getByRole("status", { name: "Loading Projects" })).toBeVisible();
    expect(editor).not.toBeVisible();
    expect(editor).toHaveValue("UNSENT QA draft");
    expect(active()).toBe("/account/projects");
    expect(screen.getByTestId("pending-command-title")).toHaveTextContent("/account/projects");
    expect(screen.getByText("Workspace controls")).toBeVisible();
    await commit("/account/projects");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("heading", { name: "Page /account/projects" })).toBeVisible();
    expect(document.querySelector(".portal-main-inner")).toHaveAttribute("aria-busy", "false");
  });

  it("follows the last destination on rapid section changes", async () => {
    render(<Router />);
    await click("/account/projects");
    await click("/account/invoices");
    await click("/account/profile");
    expect(screen.getByRole("status", { name: "Loading Profile" })).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await commit("/account/profile");
    await commit("/account/projects");
    expect(screen.queryByRole("status")).toBeNull();
    expect(active()).toBe("/account/profile");
  });

  it("clears the pending state after a destination redirects back", async () => {
    render(<Router />);
    nav.redirect = "/account";
    await click("/account/projects");
    await commit("/account/projects");
    expect(screen.queryByRole("status")).toBeNull();
    expect(active()).toBe("/account");
  });

  it("keeps an unsent editor intact when returning to the current section during a slow switch", async () => {
    render(<Router />);
    const editor = screen.getByRole("textbox", { name: "Unsent draft" });
    fireEvent.change(editor, { target: { value: "Keep this draft" } });
    await click("/account/projects");
    await click("/account");
    await commit("/account");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Unsent draft" })).toBe(editor);
    expect(editor).toHaveValue("Keep this draft");
  });

  it("preserves modified clicks and does not start a transition for the current section", async () => {
    render(<Router />);
    await click("/account");
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      await click("/account/projects", options);
    }
    expect(pushes).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("provides an accessible route fallback for a nested client page without placeholder controls", () => {
    render(<nav.path.Provider value="/account/onboarding/test-assignment"><Loading /></nav.path.Provider>);
    expect(screen.getByRole("status", { name: "Loading Onboarding" })).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});


it("shows a destination skeleton for a project link inside the portal, then clears on commit", async () => {
  inPageHref = "/account/projects/example";
  render(<Router initial="/account/projects" />);
  const editor = screen.getByRole("textbox", { name: "Unsent draft" });
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Open project" })); });
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(editor).not.toBeVisible();
  expect(screen.getByText("Workspace controls")).toBeVisible();
  await commit(inPageHref);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading", { name: "Page /account/projects/example" })).toBeVisible();
});

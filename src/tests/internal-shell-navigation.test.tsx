/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { startTransition, use, useEffect, useState } from "react";
import type { Context, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternalShell, navigationIcons } from "../components/shell/internal-shell";
import { UsersRound } from "lucide-react";
import { activeNavigationRoute, navigationForModules, titleForPath } from "../components/shell/nav-registry";
import type { InternalUser } from "../lib/supabase/next-server";
import { notifyTicketAccessUnavailable } from "../components/tickets/ticket-access-boundary";
import { RouteTransitionLink } from "../components/shell/route-transition";
import { interceptNextLinkNavigation, NextLinkRouter } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);

/*
 * A small stand-in for the App Router: push() commits the new pathname inside
 * a transition, as the real router does, and suspends on that route's payload
 * until the test resolves it, which is how a real navigation stays pending.
 */
const nav = vi.hoisted(() => ({
  path: null as unknown as Context<string>,
  push: (() => {}) as (route: string) => void,
}));
vi.mock("next/navigation", async () => {
  const { createContext, useContext } = await import("react");
  nav.path = createContext("/");
  return {
    usePathname: () => useContext(nav.path),
    useRouter: () => ({ push: (route: string) => nav.push(route), prefetch: () => {} }),
  };
});
vi.mock("../components/shell/workspace-command-bar", () => ({ WorkspaceCommandBar: () => null }));
vi.mock("../components/team/team-presence-provider", () => ({ TeamPresenceProvider: ({ children }: { children: ReactNode }) => children }));

const modules = Object.fromEntries(
  ["dashboard", "projects", "tickets", "reporting", "clients", "todo", "invoices", "subscriptions", "coupons", "investment_intent", "services", "forms", "team", "team_supervision", "settings"].map((id) => [id, true]),
);
const user = { id: "u1", displayName: "Test User", role: "owner", avatarUrl: null, modules, tickets: { view: true }, teamMessaging: { use: false } } as unknown as InternalUser;

const loaded = Object.assign(Promise.resolve(), { status: "fulfilled" as const, value: undefined });
let payloads: Map<string, () => void>;
let redirectTo: string | null;
let inPageHref: string | null;
let linkAttributes: Record<string, string>;
let cancelClick: boolean;
let restoreNextLink: () => void;

function Page({ pathname, ready }: { pathname: string; ready: Promise<void> }) {
  use(ready);
  return <><p>Page {pathname}</p>{inPageHref ? <>
    <input aria-label="Unsent draft" defaultValue="" />
    <RouteTransitionLink href={inPageHref} prefetch={false} {...linkAttributes} onClick={(event) => {
      if (cancelClick) event.preventDefault();
    }}><span>Next page</span></RouteTransitionLink>
  </> : null}</>;
}

function Router({ initial, role = "owner" }: { initial: string; role?: InternalUser["role"] }) {
  const [state, setState] = useState({ pathname: initial, ready: loaded as Promise<void> });
  useEffect(() => {
    nav.push = (route) => {
      const ready = new Promise<void>((resolve) => payloads.set(route, resolve));
      startTransition(() => setState({ pathname: redirectTo ?? route.split(/[?#]/)[0]!, ready }));
    };
  }, []);
  return (
    <NextLinkRouter><nav.path.Provider value={state.pathname}>
      <InternalShell user={{ ...user, role }}>
        <Page pathname={state.pathname} ready={state.ready} />
      </InternalShell>
    </nav.path.Provider></NextLinkRouter>
  );
}

function start(initial: string, role?: InternalUser["role"]) {
  const { container } = render(<Router initial={initial} role={role} />);
  const main = container.querySelector("main")!;
  return {
    main,
    visibleText: () => {
      const visible = main.cloneNode(true) as HTMLElement;
      visible.querySelectorAll("[hidden]").forEach((node) => node.remove());
      return visible.textContent;
    },
    inPageClick: (options: Record<string, unknown> = {}) => act(async () => {
      const link = main.querySelector("a")!;
      if (options.button === 1) fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
      else fireEvent.click(link, options);
    }),
    click: async (route: string) => {
      if (!container.querySelector(`.app-sidebar a[href='${route}']`)) await act(async () => fireEvent.click(container.querySelector('.app-sidebar button[aria-controls]')!));
      await act(async () => fireEvent.click(container.querySelector(`.app-sidebar a[href='${route}']`)!));
    },
    commit: (route: string) => act(async () => payloads.get(route)!()),
    skeleton: () => [...main.querySelectorAll("[data-skeleton]")].map((node) => node.getAttribute("data-skeleton")),
    active: () => container.querySelector(".app-sidebar a[aria-current='page']")?.getAttribute("href"),
  };
}

beforeEach(() => {
  payloads = new Map();
  redirectTo = null;
  inPageHref = null;
  linkAttributes = {};
  cancelClick = false;
  restoreNextLink = interceptNextLinkNavigation((href) => nav.push(href));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  restoreNextLink();
  vi.unstubAllGlobals();
});

describe("Sidebar navigation renders the destination skeleton", () => {
  it("redacts an internal Ticket segment from the mounted shell on confirmed denial", () => {
    const shell = start('/tickets/70000000-0000-4000-8000-000000000010');
    expect(shell.visibleText()).toContain('Page /tickets/');
    act(() => notifyTicketAccessUnavailable('70000000-0000-4000-8000-000000000010'));
    expect(shell.visibleText()).not.toContain('Page /tickets/');
    expect(shell.visibleText()).toContain('unavailable');
  });
  it("leaves independent Team segments visible on a Ticket module denial", () => {
    const shell = start('/team');
    act(() => notifyTicketAccessUnavailable());
    expect(shell.visibleText()).toBe('Page /team');
  });
  it.each([
    ["/team", "/investment-intent", "investmentIntent"],
    ["/dashboard", "/tickets", "tickets"],
    ["/tickets", "/reporting", "reporting"],
    ["/team", "/team/all-conversations", "conversations"],
    ["/team/all-conversations", "/team", "team"],
  ])("%s → %s shows the %s skeleton, marks it active, then shows the page on commit", async (from, to, variant) => {
    const shell = start(from);
    expect(shell.visibleText()).toBe(`Page ${from}`);

    await shell.click(to);
    expect(shell.skeleton()).toEqual([variant]);
    expect(shell.visibleText()).not.toContain(`Page ${from}`);
    expect(shell.active()).toBe(to);
    expect(shell.main.className).toBe("workspace-route-stage");

    await shell.commit(to);
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toBe(`Page ${to}`);
    expect(shell.active()).toBe(to);
  });

  it("covers every sidebar destination with its own skeleton, never the generic or previous one", async () => {
    const routes = ["/dashboard", "/orders", "/tickets", "/reporting", "/clients", "/invoices", "/subscriptions", "/coupons", "/investment-intent", "/services", "/forms", "/team", "/team/all-conversations", "/settings"];
    const seen = new Set<string>();
    for (const [index, route] of routes.entries()) {
      const shell = start(routes[(index + routes.length - 1) % routes.length]!);
      await shell.click(route);
      const [variant] = shell.skeleton();
      expect(variant, route).toBeTruthy();
      expect(variant, route).not.toBe("generic");
      expect(shell.active(), route).toBe(route);
      seen.add(variant!);
      cleanup();
    }
    expect(seen.size).toBe(routes.length);
  });

  it("clears the pending skeleton when the navigation lands back on the current path", async () => {
    const shell = start("/team");
    redirectTo = "/team";
    await shell.click("/investment-intent");
    expect(shell.skeleton()).toEqual(["investmentIntent"]);

    await shell.commit("/investment-intent");
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toBe("Page /team");
    expect(shell.active()).toBe("/team");
  });

  it("ends a rapid A → B → C run on the C skeleton only, then the C page", async () => {
    const shell = start("/dashboard");
    await shell.click("/orders");
    await shell.click("/tickets");
    await shell.click("/reporting");
    expect(shell.skeleton()).toEqual(["reporting"]);
    expect(shell.active()).toBe("/reporting");

    await shell.commit("/reporting");
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toBe("Page /reporting");
  });

  it.each(["owner", "admin", "manager", "staff"] as const)("lets %s cancel a pending destination by returning to the current sidebar page", async (role) => {
    const shell = start("/dashboard", role);
    await shell.click("/orders");
    expect(shell.skeleton()).toEqual(["projects"]);

    await shell.click("/dashboard");
    expect(payloads.has("/dashboard")).toBe(true);
    await shell.commit("/dashboard");
    expect(shell.skeleton()).toEqual([]);
    expect(shell.active()).toBe("/dashboard");
    expect(shell.visibleText()).toBe("Page /dashboard");

    await shell.commit("/orders");
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toBe("Page /dashboard");
  });

  it("leaves modified clicks and the current route to the browser", async () => {
    const shell = start("/team");
    await shell.click("/team");
    expect(shell.skeleton()).toEqual([]);
    fireEvent.click(document.querySelector(".app-sidebar a[href='/tickets']")!, { ctrlKey: true });
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toBe("Page /team");
  });
});

describe("Services disclosure and sidebar follow-ups", () => {
  it("has separate navigation and disclosure, icon-free children and unique surface IDs", async () => {
    const { container } = render(<Router initial="/dashboard" />);
    const sidebar = container.querySelector('.app-sidebar')!;
    const toggle = sidebar.querySelector<HTMLButtonElement>('button[aria-controls]')!;
    expect(toggle).toHaveAccessibleName('Expand Services');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar.querySelector('a[href="/coupons"]')).toBeNull();
    fireEvent.click(toggle);
    expect(payloads.size).toBe(0);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect([...sidebar.querySelectorAll('.sidebar-children a')].map(a => a.textContent)).toEqual(['Coupons', 'Investment Intent']);
    expect(sidebar.querySelector('.sidebar-children svg')).toBeNull();
    expect(sidebar.querySelector('a button, button a')).toBeNull();
    expect(sidebar.textContent).not.toContain('Marketing');
    const ids = [...container.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.click(toggle);
    expect(sidebar.querySelector('a[href="/coupons"]')).toBeNull();
    await act(async () => fireEvent.click(sidebar.querySelector('a[href="/services"]')!));
    expect(payloads.has('/services')).toBe(true);
  });

  it.each(['/coupons/new', '/investment-intent/one'])("exposes active child on direct entry %s and permits manual collapse", (path) => {
    const { container } = render(<Router initial={path} />);
    const sidebar = container.querySelector('.app-sidebar')!;
    const toggle = sidebar.querySelector('button[aria-controls]')!;
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar.querySelector('a[aria-current="page"]')).toHaveAttribute('href', activeNavigationRoute(path));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar.querySelector('.sidebar-children a')).toBeNull();
  });

  it("keeps independently granted children when Services is unavailable", () => {
    const setup = navigationForModules({ services: false, coupons: true, investment_intent: false }).find(c => c.id === 'setup');
    expect(setup?.items).toMatchObject([{ id: 'services', navigable: false, children: [{ id: 'coupons' }] }]);
    expect(navigationForModules({ services: false, coupons: false, investment_intent: false })).toEqual([]);
    expect(navigationForModules({ services: true, coupons: false }).find(c => c.id === 'setup')?.items[0]?.children).toEqual([]);
  });

  it("hides Operations for every role, retains direct titles and changes only Members' icon", () => {
    expect(navigationForModules(modules).flatMap(c => c.items).some(i => i.route === '/todo')).toBe(false);
    expect(titleForPath('/todo')).toBe('Operations');
    expect(titleForPath('/todo/departments/example')).toBe('Operations');
    expect(titleForPath('/coupons/new')).toBe('Coupons');
    expect(activeNavigationRoute('/services/example')).toBe('/services');
    expect(navigationIcons.team).toBe(UsersRound);
  });

  it.each(['owner', 'admin', 'manager', 'staff'] as const)('keeps Operations hidden for %s', (role) => {
    const { container } = render(<Router initial="/todo/departments" role={role} />);
    expect(container.querySelector('a[href="/todo"]')).toBeNull();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])('leaves Services and child modifier click %j to the browser', async (options) => {
    const { container } = render(<Router initial="/coupons" />);
    for (const route of ['/services', '/coupons', '/investment-intent']) {
      const anchor = container.querySelector(`.app-sidebar a[href="${route}"]`)!;
      expect(anchor.tagName).toBe('A');
      await act(async () => fireEvent.click(anchor, options));
    }
    expect(payloads.size).toBe(0);
  });
});


describe("in-page navigation", () => {
  it.each([
    ["/orders/one", "projectDetail"], ["/tickets/one", "ticketDetail"],
    ["/reporting/one", "reportDetail"], ["/invoices/one", "invoiceDetail"],
    ["/invoices/one/edit", "invoiceEditor"], ["/invoices/new", "invoiceEditor"],
    ["/subscriptions/one", "subscriptionDetail"], ["/coupons/new", "couponEditor"],
    ["/coupons/one", "couponEditor"], ["/services/new?folder=one", "serviceEditor"],
  ])("shows %s immediately with %s", async (href, variant) => {
    inPageHref = href;
    const shell = start("/dashboard");
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual([variant]);
    await shell.commit(href);
    expect(shell.skeleton()).toEqual([]);
  });
  it("shows Coupon status loading without losing its active sidebar", async () => {
    inPageHref = "/coupons?view=archived";
    const shell = start("/coupons");
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual(["coupons"]);
    expect(shell.active()).toBe("/coupons");
    await shell.commit(inPageHref);
    expect(shell.skeleton()).toEqual([]);
  });
  it("shows the destination on tap and clears only when it commits", async () => {
    inPageHref = "/forms/example";
    const shell = start("/forms");
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual(["generic"]);
    expect(shell.main.querySelector('[role="status"]')?.closest('[aria-busy="true"]')).toBeNull();
    expect(shell.visibleText()).not.toContain("Page /forms");
    await shell.commit(inPageHref);
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toContain("Page /forms/example");
  });

  it.each(["/invoices?status=paid", "/invoices#history"])("keeps same-path %s changes in place", async (href) => {
    inPageHref = href;
    const shell = start("/invoices");
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toContain("Page /invoices");
    await shell.commit(href);
  });

  it.each([
    [{ ctrlKey: true }, {}], [{ metaKey: true }, {}], [{ shiftKey: true }, {}],
    [{ altKey: true }, {}], [{ button: 1 }, {}], [{}, { target: "_blank" }],
    [{}, { download: "" }], [{}, { "data-route-skeleton": "off" }],
  ])("preserves excluded click %j / %j", async (options, attributes) => {
    inPageHref = "/forms/example";
    linkAttributes = attributes;
    const shell = start("/forms");
    await shell.inPageClick(options);
    expect(shell.skeleton()).toEqual([]);
    if (payloads.has(inPageHref)) await shell.commit(inPageHref);
  });

  it("leaves the persistent Settings frame visible", async () => {
    inPageHref = "/settings/team";
    const shell = start("/settings/general");
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual([]);
    expect(shell.visibleText()).toContain("Page /settings/general");
    await shell.commit(inPageHref);
  });

  it("retains the mounted input through a cancelled navigation", async () => {
    inPageHref = "/forms/example";
    const shell = start("/forms");
    const editor = shell.main.querySelector("input")!;
    fireEvent.change(editor, { target: { value: "Keep this draft" } });
    redirectTo = "/forms";
    await shell.inPageClick();
    expect(editor).not.toBeVisible();
    expect(shell.main.querySelector("input")).toBe(editor);
    await shell.commit(inPageHref);
    expect(editor).toBeVisible();
    expect(editor.value).toBe("Keep this draft");
    expect(shell.skeleton()).toEqual([]);
  });

  it("does not leave a skeleton or discard input after preventDefault cancels a tap", async () => {
    inPageHref = "/forms/example";
    cancelClick = true;
    const shell = start("/forms");
    const editor = shell.main.querySelector("input")!;
    fireEvent.change(editor, { target: { value: "Unsent" } });
    await shell.inPageClick();
    expect(shell.skeleton()).toEqual([]);
    expect(shell.main.querySelector("input")).toBe(editor);
    expect(editor.value).toBe("Unsent");
  });
});

/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { startTransition, use, useEffect, useState } from "react";
import type { Context, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternalShell } from "../components/shell/internal-shell";
import type { InternalUser } from "../lib/supabase/next-server";
import { notifyTicketAccessUnavailable } from "../components/tickets/ticket-access-boundary";

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

function Page({ pathname, ready }: { pathname: string; ready: Promise<void> }) {
  use(ready);
  return <p>Page {pathname}</p>;
}

function Router({ initial }: { initial: string }) {
  const [state, setState] = useState({ pathname: initial, ready: loaded as Promise<void> });
  useEffect(() => {
    nav.push = (route) => {
      const ready = new Promise<void>((resolve) => payloads.set(route, resolve));
      startTransition(() => setState({ pathname: redirectTo ?? route, ready }));
    };
  }, []);
  return (
    <nav.path.Provider value={state.pathname}>
      <InternalShell user={user}>
        <Page pathname={state.pathname} ready={state.ready} />
      </InternalShell>
    </nav.path.Provider>
  );
}

function start(initial: string) {
  const { container } = render(<Router initial={initial} />);
  const main = container.querySelector("main")!;
  return {
    main,
    click: (route: string) => act(async () => { fireEvent.click(container.querySelector(`.app-sidebar a[href='${route}']`)!); }),
    commit: (route: string) => act(async () => payloads.get(route)!()),
    skeleton: () => [...main.querySelectorAll("[data-skeleton]")].map((node) => node.getAttribute("data-skeleton")),
    active: () => container.querySelector(".app-sidebar a[aria-current='page']")?.getAttribute("href"),
  };
}

beforeEach(() => {
  payloads = new Map();
  redirectTo = null;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sidebar navigation renders the destination skeleton", () => {
  it("redacts an internal Ticket segment from the mounted shell on confirmed denial", () => {
    const shell = start('/tickets/70000000-0000-4000-8000-000000000010');
    expect(shell.main.textContent).toContain('Page /tickets/');
    act(() => notifyTicketAccessUnavailable('70000000-0000-4000-8000-000000000010'));
    expect(shell.main.textContent).not.toContain('Page /tickets/');
    expect(shell.main.textContent).toContain('unavailable');
  });
  it("leaves independent Team segments visible on a Ticket module denial", () => {
    const shell = start('/team');
    act(() => notifyTicketAccessUnavailable());
    expect(shell.main.textContent).toBe('Page /team');
  });
  it.each([
    ["/team", "/investment-intent", "investmentIntent"],
    ["/dashboard", "/tickets", "tickets"],
    ["/tickets", "/reporting", "reporting"],
    ["/team", "/team/all-conversations", "conversations"],
    ["/team/all-conversations", "/team", "team"],
  ])("%s → %s shows the %s skeleton, marks it active, then shows the page on commit", async (from, to, variant) => {
    const shell = start(from);
    expect(shell.main.textContent).toBe(`Page ${from}`);

    await shell.click(to);
    expect(shell.skeleton()).toEqual([variant]);
    expect(shell.main.textContent).not.toContain(`Page ${from}`);
    expect(shell.active()).toBe(to);
    expect(shell.main.className).toBe("workspace-route-stage");

    await shell.commit(to);
    expect(shell.skeleton()).toEqual([]);
    expect(shell.main.textContent).toBe(`Page ${to}`);
    expect(shell.active()).toBe(to);
  });

  it("covers every sidebar destination with its own skeleton, never the generic or previous one", async () => {
    const routes = ["/dashboard", "/orders", "/tickets", "/reporting", "/clients", "/todo", "/invoices", "/subscriptions", "/coupons", "/investment-intent", "/services", "/forms", "/team", "/team/all-conversations", "/settings"];
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
    expect(shell.main.textContent).toBe("Page /team");
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
    expect(shell.main.textContent).toBe("Page /reporting");
  });

  it("leaves modified clicks and the current route to the browser", async () => {
    const shell = start("/team");
    await shell.click("/team");
    expect(shell.skeleton()).toEqual([]);
    fireEvent.click(document.querySelector(".app-sidebar a[href='/tickets']")!, { ctrlKey: true });
    expect(shell.skeleton()).toEqual([]);
    expect(shell.main.textContent).toBe("Page /team");
  });
});

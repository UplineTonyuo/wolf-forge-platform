/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coveredRoute, navigationUrlForClick, RouteTransitionProvider, useRouteTransitionPush } from "../components/shell/route-transition";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.clearAllMocks(); });

const internal = (path: string) => !/^\/(account|api|activate|f|launch|login)(\/|$)/.test(path);
const portal = (path: string) => path === "/account" || path.startsWith("/account/");
const url = (href: string) => new URL(href, window.location.href);

describe("coveredRoute", () => {
  it.each([
    ["/orders", "/orders/one", "/orders/one"],
    ["/orders/one", "/orders/two", "/orders/two"],
    ["/orders/one", "/orders/one/responses", null],
    ["/orders/one/responses", "/orders/one/activity", null],
    ["/orders/new", "/orders/new/example", "/orders/new/example"],
    ["/settings/general", "/settings/team", null],
    ["/settings", "/settings/team", null],
    ["/settings/general", "/settings-other", "/settings-other"],
    ["/forms", "/forms/a", "/forms/a"],
    ["/invoices", "/invoices?status=paid", null],
    ["/coupons", "/coupons?view=archived", "/coupons"],
    ["/coupons", "/coupons", null],
    ["/clients", "/clients#history", null],
    ["/dashboard", "https://other.example/orders", null],
  ])("%s -> %s returns %s", (current, destination, expected) => {
    expect(coveredRoute(url(destination), current, internal)).toBe(expected);
  });

  it.each(["/account", "/account/projects", "/api/data", "/activate", "/f/example", "/launch", "/login"])("excludes internal destination %s", (destination) => {
    expect(coveredRoute(url(destination), "/dashboard", internal)).toBeNull();
  });

  it("keeps the portal scope distinct", () => {
    expect(coveredRoute(url("/account/projects/x"), "/account/projects", portal)).toBe("/account/projects/x");
    expect(coveredRoute(url("/accounting"), "/account", portal)).toBeNull();
    expect(coveredRoute(url("/orders"), "/account", portal)).toBeNull();
  });
});

function click(target: EventTarget, options = {}) {
  return { target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options } as MouseEvent<HTMLElement>;
}

describe("navigationUrlForClick", () => {
  function anchor(attributes = "") {
    document.body.innerHTML = `<div><a href="/forms/example?tab=1#details" ${attributes}><span>Open</span></a></div>`;
    return document.querySelector("span")!;
  }

  it("finds links through nested elements and text nodes, including Link's preventDefault", () => {
    const target = anchor();
    expect(navigationUrlForClick(click(target))?.href).toBe(url("/forms/example?tab=1#details").href);
    expect(navigationUrlForClick(click(target.firstChild!, { defaultPrevented: true }))?.pathname).toBe("/forms/example");
    expect(navigationUrlForClick(click(anchor('target="_self"')))?.pathname).toBe("/forms/example");
  });

  it.each([{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])("excludes modified click %j", (options) => {
    expect(navigationUrlForClick(click(anchor(), options))).toBeNull();
  });

  it.each(['download', 'target="_blank"', 'target="frame"', 'data-route-skeleton="off"'])("excludes %s", (attributes) => {
    expect(navigationUrlForClick(click(anchor(attributes)))).toBeNull();
  });

  it("respects an opt-out on an ancestor or a nested child", () => {
    const target = anchor();
    target.parentElement!.parentElement!.dataset.routeSkeleton = "off";
    expect(navigationUrlForClick(click(target))).toBeNull();
    delete target.parentElement!.parentElement!.dataset.routeSkeleton;
    target.dataset.routeSkeleton = "off";
    expect(navigationUrlForClick(click(target))).toBeNull();
  });

  it("ignores non-links and detached targets", () => {
    expect(navigationUrlForClick(click(document.createElement("button")))).toBeNull();
    expect(navigationUrlForClick(click(document.createTextNode("text")))).toBeNull();
    expect(navigationUrlForClick(click(window))).toBeNull();
  });
});

describe("useRouteTransitionPush", () => {
  it("is exactly router.push without a provider", () => {
    const { result } = renderHook(useRouteTransitionPush);
    expect(result.current).toBe(router.push);
    result.current("/forms/a", { scroll: false });
    expect(router.push).toHaveBeenCalledWith("/forms/a", { scroll: false });
  });

  it("begins the destination before forwarding href and options", () => {
    const calls: string[] = [];
    const begin = vi.fn((destination: URL) => calls.push(destination.pathname));
    router.push.mockImplementation(() => calls.push("push"));
    const wrapper = ({ children }: { children: ReactNode }) => <RouteTransitionProvider begin={begin}>{children}</RouteTransitionProvider>;
    const { result } = renderHook(useRouteTransitionPush, { wrapper });
    act(() => result.current("/forms/a?created=1", { scroll: false }));
    expect(calls).toEqual(["/forms/a", "push"]);
    expect(begin.mock.calls[0]?.[0].search).toBe("?created=1");
    expect(router.push).toHaveBeenCalledWith("/forms/a?created=1", { scroll: false });
  });
});

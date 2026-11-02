/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createContext, startTransition, use, useContext, useEffect, useState, type Context } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTabs } from "../components/projects/order-tabs";
import { OrderSectionContent, OrderSectionProvider } from "../components/projects/order-section-transition";
import { NextLinkRouter, interceptNextLinkNavigation } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);
const nav = vi.hoisted(() => ({ path: null as unknown as Context<string> }));
vi.mock("next/navigation", () => ({ usePathname: () => useContext(nav.path) }));
nav.path = createContext("/orders/one");
const loaded = Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined });
let move: (href: string) => void;
let restore: () => void;
let payloads: Map<string, () => void>;
function Body({ ready, path }: { ready: Promise<void>; path: string }) {
  use(ready);
  return <><p>Loaded {path}</p><input aria-label="Unsent order draft" defaultValue="Keep me" /></>;
}
function Router() {
  const [route, setRoute] = useState({ path: "/orders/one", ready: loaded as Promise<void> });
  useEffect(() => {
    move = (path) => startTransition(() => setRoute({ path, ready: new Promise<void>(resolve => payloads.set(path, resolve)) }));
  }, []);
  return <NextLinkRouter><nav.path.Provider value={route.path}><OrderSectionProvider>
    <h1>Stable order title</h1><OrderTabs orderId="one" />
    <OrderSectionContent><Body ready={route.ready} path={route.path} /></OrderSectionContent>
    <aside>Stable order rail</aside>
  </OrderSectionProvider></nav.path.Provider></NextLinkRouter>;
}
beforeEach(() => { payloads = new Map(); restore = interceptNextLinkNavigation(href => move(href)); });
afterEach(() => { restore(); cleanup(); });
async function click(label: string) { await act(async () => { fireEvent.click(screen.getByRole("link", { name: label })); }); }
async function commit(path: string) { await act(async () => payloads.get(path)?.()); }
describe("Order section loading", () => {
  it("replaces only the body immediately, retains drafts, and ends on the committed section", async () => {
    const { container } = render(<Router />);
    const draft = screen.getByRole("textbox");
    await click("Files");
    expect(screen.getByRole("heading", { name: "Stable order title" })).toBeVisible();
    expect(screen.getByText("Stable order rail")).toBeVisible();
    expect(container.querySelector('[data-skeleton-body="files"]')).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(draft).not.toBeVisible();
    expect(draft).toHaveValue("Keep me");
    await commit("/orders/one/files");
    expect(screen.queryByLabelText("Loading project files")).toBeNull();
    expect(screen.getByText("Loaded /orders/one/files")).toBeVisible();
  });
  it("handles rapid tabs and returning to the current section without a stale skeleton", async () => {
    const { container } = render(<Router />);
    await click("Files"); await click("History");
    expect(container.querySelector('[data-skeleton-body="history"]')).not.toBeNull();
    await click("Details"); await commit("/orders/one");
    expect(container.querySelector("[data-skeleton]")).toBeNull();
    await commit("/orders/one/history"); await commit("/orders/one/files");
    expect(screen.getByText("Loaded /orders/one")).toBeVisible();
  });
  it("leaves modified clicks immediate and untouched", async () => {
    const { container } = render(<Router />);
    fireEvent.click(screen.getByRole("link", { name: "Files" }), { ctrlKey: true });
    expect(payloads.size).toBe(0);
    expect(container.querySelector("[data-skeleton]")).toBeNull();
  });
});

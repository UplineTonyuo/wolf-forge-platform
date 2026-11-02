/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { startTransition, use, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientDetailSections } from "../components/clients/client-detail-sections";
import type { ClientSection } from "../components/shell/route-skeletons";
import { NextLinkRouter, interceptNextLinkNavigation } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);
const loaded = Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined });
let payloads: Map<string, () => void>;
let move: (path: string) => void;
let restore: () => void;
function Body({ ready, tab }: { ready: Promise<void>; tab: string }) { use(ready); return <><p>Loaded {tab}</p><input aria-label="Unsent client draft" defaultValue="Keep me" /></>; }
function Router({ initial = "details" }: { initial?: ClientSection }) {
  const [route, setRoute] = useState({ tab: initial, ready: loaded as Promise<void> });
  useEffect(() => { move = href => startTransition(() => setRoute({ tab: (new URL(href, location.href).searchParams.get("tab") ?? "details") as ClientSection, ready: new Promise<void>(resolve => payloads.set(href, resolve)) })); }, []);
  return <NextLinkRouter><h1>Stable client name</h1><ClientDetailSections companyId="one" activeTab={route.tab}><Body {...route} /></ClientDetailSections></NextLinkRouter>;
}
beforeEach(() => { payloads = new Map(); restore = interceptNextLinkNavigation(href => move(href)); });
afterEach(() => { restore(); cleanup(); });
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("link", { name })); }); }
async function commit(href: string) { await act(async () => { payloads.get(href)?.(); }); }

it.each(["details", "projects", "invoices", "activities", "history"] as const)("loads only the %s body and retains the client frame and draft", async tab => {
  const initial = tab === "details" ? "projects" : "details";
  const { container } = render(<Router initial={initial} />);
  const label = tab[0].toUpperCase() + tab.slice(1);
  const draft = screen.getByRole("textbox");
  await click(label);
  expect(screen.getByRole("heading", { name: "Stable client name" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Client sections" })).toBeVisible();
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("status", { name: `Loading client ${tab}` })).toBeVisible();
  expect(draft).not.toBeVisible(); expect(draft).toHaveValue("Keep me");
  expect(container.querySelector("[data-pending]")).toBeNull();
  const href = tab === "details" ? "/clients/one" : `/clients/one?tab=${tab}`;
  await commit(href);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText(`Loaded ${tab}`)).toBeVisible();
});
it("handles rapid Client switches and cancellation back to the current section", async () => {
  render(<Router />); await click("Invoices"); await click("History"); await click("Details");
  await commit("/clients/one"); await commit("/clients/one?tab=invoices"); await commit("/clients/one?tab=history");
  expect(screen.queryByRole("status")).toBeNull(); expect(screen.getByText("Loaded details")).toBeVisible();
});
it("does not intercept modified Client links", () => {
  render(<Router />); fireEvent.click(screen.getByRole("link", { name: "Projects" }), { ctrlKey: true });
  expect(payloads.size).toBe(0); expect(screen.queryByRole("status")).toBeNull();
});

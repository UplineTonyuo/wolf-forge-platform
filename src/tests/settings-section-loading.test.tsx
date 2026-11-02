/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createContext, startTransition, use, useContext, useEffect, useState, type Context } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsShell } from "../components/settings/settings-navigation";
import { RouteSkeleton, SettingsSectionSkeleton } from "../components/shell/route-skeletons";
import report from "../components/reporting/reporting.module.css";
import settings from "../components/settings/settings-foundation.module.css";
import profile from "../components/settings/settings-workspace.module.css";
import manual from "../components/invoices/invoice-manual-payment.module.css";
import { NextLinkRouter, interceptNextLinkNavigation } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);
const nav = vi.hoisted(() => ({ path: null as unknown as Context<string> }));
vi.mock("next/navigation", () => ({ usePathname: () => useContext(nav.path) }));
nav.path = createContext("/settings/general");
const loaded = Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined });
let payloads: Map<string, () => void>;
let restore: () => void;
let move: (path: string) => void;
function Body({ ready, path }: { ready: Promise<void>; path: string }) { use(ready); return <p>Loaded {path}</p>; }
function Router() {
  const [route, setRoute] = useState({ path: "/settings/general", ready: loaded as Promise<void> });
  useEffect(() => { move = path => startTransition(() => setRoute({ path, ready: new Promise<void>(resolve => payloads.set(path, resolve)) })); }, []);
  return <NextLinkRouter><nav.path.Provider value={route.path}><h1>Settings</h1><SettingsShell><Body {...route} /></SettingsShell></nav.path.Provider></NextLinkRouter>;
}
beforeEach(() => { payloads = new Map(); restore = interceptNextLinkNavigation(path => move(path)); });
afterEach(() => { restore?.(); cleanup(); });
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("link", { name })); }); }
async function commit(path: string) { await act(async () => { payloads.get(path)?.(); }); }

it.each(["Team & Access", "Billing & Payments", "Integrations", "Notifications", "Security"])("shows the %s body immediately while retaining Settings navigation", async name => {
  render(<Router />);
  await click(name);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  expect(screen.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("status", { name: `Loading ${name} settings` })).toBeVisible();
  expect(screen.getByText("Loaded /settings/general")).not.toBeVisible();
  const path = new URL(screen.getByRole("link", { name }).getAttribute("href")!, location.href).pathname;
  await commit(path);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText(`Loaded ${path}`)).toBeVisible();
});

it("cancels rapid Settings switches when returning to the current section", async () => {
  render(<Router />); await click("Integrations"); await click("Notifications"); await click("General");
  await commit("/settings/general"); await commit("/settings/integrations"); await commit("/settings/notifications");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("Loaded /settings/general")).toBeVisible();
});

it("leaves modified Settings links untouched", () => {
  render(<Router />); fireEvent.click(screen.getByRole("link", { name: "Integrations" }), { ctrlKey: true });
  expect(payloads.size).toBe(0); expect(screen.queryByRole("status")).toBeNull();
});

it("uses Reporting's actual list and row layout instead of generic rows", () => {
  const { container } = render(<RouteSkeleton pathname="/reporting" />);
  expect(container.querySelector(`.${report.list}`)).toBeTruthy();
  expect(container.querySelectorAll(`.${report.row}`)).toHaveLength(5);
  expect(container.querySelectorAll(`.${report.rowMain} .${report.rowMeta}`)).toHaveLength(5);
  expect(container.querySelectorAll(`.${report.rowSide}`)).toHaveLength(5);
  expect(container.querySelector(`.page-actions > .${report.compactAction}.page-action-compact`)).toBeTruthy();
});

it.each([
  ["general", profile.identity, 1],
  ["team", settings.teamMetric, 3],
  ["billing", manual.form, 1],
  ["integrations", settings.providerCard, 3],
  ["notifications", settings.preferenceRow, 1],
  ["security", profile.toggleRow, 1],
] as const)("reserves %s content using that page's structural classes", (section, layoutClass, count) => {
  const { container } = render(<SettingsSectionSkeleton section={section} />);
  expect(container.querySelectorAll(`.${layoutClass}`)).toHaveLength(count);
  expect(container.querySelector("[data-settings-section]")).toHaveAttribute("data-settings-section", section);
  expect(container.querySelector("nav, .page-header, input, button, a")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

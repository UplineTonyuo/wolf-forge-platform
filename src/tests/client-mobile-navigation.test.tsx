/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientPortalSidebar } from "../components/account/client-portal-sidebar";
import { PortalDrawerProvider, usePortalDrawer } from "../components/account/command/portal-drawer";
import { portalNavigationFor } from "../components/account/portal-nav-registry";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));
vi.mock("../components/pwa/pwa-provider", () => ({ PwaInstallButton: () => null }));
vi.mock("../components/tickets/client-draft-provider", () => ({ ClientDraftSignOut: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/shell/wolf-forge-mark", () => ({ WolfForgeMark: () => <span>Logo</span> }));
vi.mock("../app/actions/auth", () => ({ signOutAction: vi.fn() }));

let mobile: boolean;
let resize: (() => void) | undefined;
beforeEach(() => {
  mobile = true;
  vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener: (_name: string, callback: () => void) => { resize = callback; }, removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Controls() {
  const drawer = usePortalDrawer();
  return <button aria-expanded={drawer?.open} onClick={() => drawer?.toggle()}>Open navigation</button>;
}
function Workspace() {
  return <PortalDrawerProvider><Controls /><ClientPortalSidebar
    categories={portalNavigationFor({ portal_dashboard: true, portal_projects: true })}
    companyName="Synthetic client" displayName="Synthetic" /><input aria-label="Unsent reply" defaultValue="Saved editor state" />
  </PortalDrawerProvider>;
}

it("uses native closed-dialog semantics and synchronizes cancellation without remounting the editor", () => {
  render(<Workspace />);
  expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument();
  const editor = screen.getByRole("textbox", { name: "Unsent reply" });
  fireEvent.change(editor, { target: { value: "Keep this unsent reply" } });
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Wolf Forge navigation" });
  expect(dialog).toHaveAttribute("open");
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent(dialog, new Event("cancel", { bubbles: true }));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(dialog).not.toHaveAttribute("open");
  expect(editor).toHaveValue("Keep this unsent reply");
  expect(document.body.style.overflow).toBe("");
});

it("closes the mobile dialog when returning to desktop and leaves one navigation tree", () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  act(() => { mobile = false; resize?.(); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("navigation", { name: "Client portal" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Orders" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
});

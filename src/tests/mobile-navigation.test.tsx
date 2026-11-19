/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { InternalShell } from "../components/shell/internal-shell";
import type { InternalUser } from "../lib/supabase/next-server";

const navigation = vi.hoisted(() => ({ path:"/orders",push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path, useRouter: () => ({ push: navigation.push, prefetch: vi.fn() }) }));
vi.mock("../components/shell/workspace-command-bar", () => ({ WorkspaceCommandBar: ({ mobileNavigation }: { mobileNavigation: ReactNode }) => mobileNavigation }));
vi.mock("../components/team/team-presence-provider", () => ({ TeamPresenceProvider: ({ children }: { children: ReactNode }) => children }));
afterEach(()=>{ navigation.path="/orders";cleanup(); });

it("opens Process settings from a direct mobile URL and returns to primary navigation",()=>{
  navigation.path="/settings/process/orders";
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
  render(<InternalShell user={{id:"u1",displayName:"Admin",role:"admin",modules:{settings:true},teamMessaging:{use:false}} as unknown as InternalUser}><p>Orders</p></InternalShell>);
  fireEvent.click(screen.getByRole("button",{name:"Open navigation"}));
  const dialog=screen.getByRole("dialog");
  expect(within(dialog).getByRole("link",{name:"Orders"})).toHaveAttribute("aria-current","page");
  fireEvent.click(within(dialog).getByRole("link",{name:"Back"}));
  expect(navigation.push).toHaveBeenCalledWith("/dashboard");
  expect(dialog).not.toHaveAttribute("open");
  vi.unstubAllGlobals();
});

it("opens the native modal, preserves permitted navigation and closes on destination, backdrop and desktop resize", () => {
  let resize = () => {};
  const media = { matches: false, addEventListener: (_: string, callback: () => void) => { resize = callback; }, removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  render(
    <InternalShell
      user={
        {
          id: "u1",
          displayName: "Test User",
          role: "staff",
          avatarUrl: null,
          modules: { projects: true, tickets: true },
          teamMessaging: { use: false },
        } as unknown as InternalUser
      }
    >
      <p>Order content</p>
    </InternalShell>,
  );
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  const open = () => {
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    return screen.getByRole("dialog", { name: "Wolf Forge navigation" });
  };
  let dialog = open();
  const header = dialog.querySelector(".mobile-nav-header");
  expect(header).toHaveTextContent("WOLF FORGE");
  expect(header?.querySelector(":scope > svg, :scope > img")).toBeNull();
  const account = within(dialog).getByRole("button", { name: "Account" });
  expect(within(account).getByText("Test User")).toBeInTheDocument();
  expect(within(account).getByText("staff")).toBeInTheDocument();
  expect(within(dialog).getAllByRole("link").map((link) => link.textContent)).toEqual(["Orders", "Tickets", "Goals"]);
  expect(within(dialog).queryByRole("link", { name: "Members" })).toBeNull();
  const destination = within(dialog).getByRole("link", { name: "Orders" });
  destination.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(destination);
  expect(dialog).not.toHaveAttribute("open");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  dialog = open();
  fireEvent.click(dialog);
  expect(dialog).not.toHaveAttribute("open");
  dialog = open();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation" }));
  expect(dialog).not.toHaveAttribute("open");
  dialog = open();
  media.matches = true;
  act(resize);
  expect(dialog).not.toHaveAttribute("open");
  vi.unstubAllGlobals();
});

it("toggles Services in the mobile drawer without closing or navigating and keeps child grants independent", () => {
  navigation.push.mockClear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  render(<InternalShell user={{ id: 'u1', displayName: 'Synthetic staff', role: 'staff', modules: { services: false, coupons: true, investment_intent: true, todo: true }, teamMessaging: { use: false } } as unknown as InternalUser}><p>Orders</p></InternalShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('link', { name: 'Services' })).toBeNull();
  expect(within(dialog).queryByRole('link', { name: 'Operations' })).toBeNull();
  const toggle = within(dialog).getByRole('button', { name: 'Expand Services' });
  toggle.focus();
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(dialog).toHaveAttribute('open');
  expect(navigation.push).not.toHaveBeenCalled();
  const child = within(dialog).getByRole('link', { name: 'Coupons' });
  expect(child.querySelector('svg')).toBeNull();
  fireEvent.click(child);
  expect(navigation.push).toHaveBeenCalledWith('/coupons');
  expect(dialog).not.toHaveAttribute('open');
  vi.unstubAllGlobals();
});

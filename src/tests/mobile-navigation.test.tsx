/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { InternalShell } from "../components/shell/internal-shell";
import type { InternalUser } from "../lib/supabase/next-server";

vi.mock("next/navigation", () => ({ usePathname: () => "/orders", useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("../components/shell/workspace-command-bar", () => ({ WorkspaceCommandBar: ({ mobileNavigation }: { mobileNavigation: ReactNode }) => mobileNavigation }));
vi.mock("../components/team/team-presence-provider", () => ({ TeamPresenceProvider: ({ children }: { children: ReactNode }) => children }));
afterEach(cleanup);

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

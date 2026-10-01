/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InternalLoading from "../app/(internal)/loading";
import { InternalShell } from "../components/shell/internal-shell";
import type { InternalUser } from "../lib/supabase/next-server";

const nav = vi.hoisted(() => ({ pathname: "/orders", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push, prefetch: vi.fn() }) }));
vi.mock("../components/shell/workspace-command-bar", () => ({ WorkspaceCommandBar: () => null }));
vi.mock("../components/team/team-presence-provider", () => ({ TeamPresenceProvider: ({ children }: { children: ReactNode }) => children }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Internal route loading boundary", () => {
  it("swaps the content pane to a visible skeleton on a sidebar click until the route commits", () => {
    nav.pathname = "/orders";
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = { id: "u1", displayName: "Test User", role: "staff", avatarUrl: null, modules: { projects: true, tickets: true }, teamMessaging: { use: false } } as unknown as InternalUser;
    const shell = (page: string) => <InternalShell user={user}><p>{page}</p></InternalShell>;
    const { container, rerender } = render(shell("Projects page"));
    const main = container.querySelector("main")!;

    fireEvent.click(container.querySelector(".app-sidebar a[href='/tickets']")!);

    expect(nav.push).toHaveBeenCalledWith("/tickets");
    expect(main.querySelector(".internal-page-skeleton")).toBeTruthy();
    expect(main.textContent).not.toContain("Projects page");
    // The pane itself is never put into a hidden transition state.
    expect(main.className).toBe("workspace-route-stage");
    expect(container.querySelector(".app-sidebar a[aria-current='page']")?.textContent).toBe("Tickets");

    nav.pathname = "/tickets";
    rerender(shell("Tickets page"));
    expect(main.querySelector(".internal-page-skeleton")).toBeNull();
    expect(main.textContent).toBe("Tickets page");
  });

  it("no longer ships a rule that hides the route stage", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");
    expect(css).not.toMatch(/is-vacuuming|is-entering/u);
  });

  it("renders one status inside the real page frame with decorative bars hidden", () => {
    const { container } = render(<InternalLoading />);
    const status = screen.getByRole("status");

    expect(status.classList.contains("page-frame")).toBe(true);
    expect(status.textContent).toBe("Loading page");
    expect(container.querySelector(".page-header")?.closest("[aria-hidden='true']")).toBeTruthy();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelectorAll(".internal-page-skeleton-card")).toHaveLength(3);
  });

  it("drops the All Conversations header divider only on that page", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../components/team-supervision/supervised-transcript.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.frame :global\(\.page-header\)\s*\{\s*border-bottom:\s*0;/u);
  });

  it("gives the Inbox Tickets search one focus treatment, not wrapper and input outlines", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../components/team/team-messages.module.css"), "utf8");
    expect(css).not.toContain(".ticketSearch:focus-within");
    expect(css).toMatch(/\.ticketSearch:has\(input:focus\)\s*\{[^}]*box-shadow/u);
    expect(css).toMatch(/\.ticketSearch input:focus-visible\s*\{\s*outline:\s*0;/u);
  });
});

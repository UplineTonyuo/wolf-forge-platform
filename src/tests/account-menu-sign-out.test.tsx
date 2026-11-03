/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../components/shell/account-menu";
import type { InternalUser } from "../lib/supabase/next-server";
import * as authActions from "../app/actions/auth";
import { PwaProvider } from "../components/pwa/pwa-provider";

vi.mock("../app/actions/auth", () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockImplementation(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});

const user = { id: "u1", displayName: "Anthony Paghubasan", avatarUrl: null, role: "owner" } as unknown as InternalUser;

describe("AccountMenu sign out", () => {
  it("keeps install and sign-out actions in matching accessible menu rows", async () => {
    render(<PwaProvider><AccountMenu user={user} /></PwaProvider>);
    const trigger = screen.getByRole("button", { name: "Account" });
    fireEvent.click(trigger);
    const install = await screen.findByRole("menuitem", { name: "Install or update app" });
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    expect(install.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(signOut.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(install).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a real pending state while signing out, and cannot be double-submitted", async () => {
    let resolveSignOut!: () => void;
    vi.mocked(authActions.signOutAction).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    render(<AccountMenu user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    const signOut = await screen.findByRole("menuitem", { name: "Sign out" });
    expect(signOut).toBeEnabled();

    fireEvent.click(signOut);
    expect(signOut).toBeDisabled();
    expect(signOut).toHaveAttribute("aria-busy", "true");

    fireEvent.click(signOut);
    expect(authActions.signOutAction).toHaveBeenCalledTimes(1);

    resolveSignOut();
  });
});

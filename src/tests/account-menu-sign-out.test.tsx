/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../components/shell/account-menu";
import type { InternalUser } from "../lib/supabase/next-server";
import * as authActions from "../app/actions/auth";

vi.mock("../app/actions/auth", () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);

const user = { id: "u1", displayName: "Anthony Paghubasan", avatarUrl: null, role: "owner" } as unknown as InternalUser;

describe("AccountMenu sign out", () => {
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

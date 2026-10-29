// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_UNAVAILABLE_MESSAGE } from "../lib/supabase/identity-lookup";

const state = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("../components/forms/login-form", () => ({
  LoginForm: ({ next = "/", initialError }: { next?: string; initialError: string | null }) => (
    <form><input type="hidden" name="next" value={next} />{initialError ? <p role="alert">{initialError}</p> : null}</form>
  ),
}));
vi.mock("../components/pwa/pwa-provider", () => ({ PwaInstallButton: () => null }));
import LoginPage from "../app/login/page";

afterEach(() => { cleanup(); state.query = ""; });

describe("prerendered login's client query form", () => {
  it.each([
    ["", "/"],
    ["next=%2Forders%3Ffilter%3Dopen%23top", "/orders?filter=open#top"],
    ["next=%2Faccount", "/account"],
    // The action still performs safeNextPath validation at the trust boundary.
    ["next=https%3A%2F%2Fevil.example", "https://evil.example"],
  ])("reads next from the client URL: %s", (query, next) => {
    state.query = query;
    const { container } = render(<LoginPage />);
    expect(container.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(next);
  });

  it.each([
    ["identity-unavailable", IDENTITY_UNAVAILABLE_MESSAGE],
    ["staff-only", "This area is for Wolf Forge team members."],
    ["client-only", "This area is for active Wolf Forge client accounts."],
  ])("preserves the %s error", (reason, message) => {
    state.query = `reason=${reason}`;
    render(<LoginPage />);
    expect(screen.getByRole("alert").textContent).toBe(message);
  });

  it("ignores unknown reason strings", () => {
    state.query = "reason=arbitrary";
    render(<LoginPage />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

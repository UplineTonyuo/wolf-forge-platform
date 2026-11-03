// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { IDENTITY_UNAVAILABLE_MESSAGE } from "../lib/supabase/identity-lookup";

const state = vi.hoisted(() => ({ query: "", suspend: false }));
vi.mock("next/navigation", () => ({ useSearchParams: () => {
  if (state.suspend) throw new Promise(() => {});
  return new URLSearchParams(state.query);
} }));
vi.mock("../app/actions/auth", () => ({ signInAction: vi.fn() }));
vi.mock("../components/pwa/pwa-provider", () => ({ PwaInstallButton: () => null }));
import LoginPage from "../app/login/page";

afterEach(() => { cleanup(); state.query = ""; state.suspend = false; });

describe("prerendered login's client query form", () => {
  it("renders the real sign-in form with default next and no error in static HTML while query reading suspends", () => {
    state.suspend = true;
    state.query = "next=%2Forders&reason=staff-only";
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LoginPage />);
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"], .login-submit')?.textContent).toContain("Sign in");
    expect(container.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
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

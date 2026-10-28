/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import InternalLoading from "../app/(internal)/loading";
import { RouteSkeleton, SectionSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";

const nav = vi.hoisted(() => ({ pathname: "/orders" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Internal route loading boundary", () => {
  it("renders a content-only section with one status, no text and no focusable controls", () => {
    const { container } = render(<SectionSkeleton />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.textContent).toBe("");
    expect(container.querySelector(".route-skeleton-section [aria-hidden='true']")).toBeTruthy();
    expect(container.querySelector(".settings-page-layout, a[href], button, input, [tabindex]")).toBeNull();
  });
  it("no longer ships a rule that hides the route stage", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");
    expect(css).not.toMatch(/is-vacuuming|is-entering/u);
  });

  it("maps sidebar destinations to their own skeletons and everything else to the generic one", () => {
    expect(getInternalSkeletonVariant("/dashboard")).toBe("dashboard");
    expect(getInternalSkeletonVariant("/orders")).toBe("projects");
    expect(getInternalSkeletonVariant("/tickets")).toBe("tickets");
    expect(getInternalSkeletonVariant("/tickets/")).toBe("tickets");
    expect(getInternalSkeletonVariant("/todo")).toBe("operations");
    expect(getInternalSkeletonVariant("/investment-intent")).toBe("investmentIntent");
    expect(getInternalSkeletonVariant("/team")).toBe("team");
    expect(getInternalSkeletonVariant("/team/all-conversations")).toBe("conversations");
    expect(getInternalSkeletonVariant("/settings")).toBe("settings");
    expect(getInternalSkeletonVariant("/settings/general")).toBe("settings");
    // Detail pages never borrow a list skeleton.
    expect(getInternalSkeletonVariant("/tickets/abc")).toBe("generic");
    expect(getInternalSkeletonVariant("/teams")).toBe("generic");
    expect(getInternalSkeletonVariant("/unknown")).toBe("generic");
  });

  it("gives Tickets its real toolbar and six-column table, without metric cards", () => {
    const { container } = render(<RouteSkeleton pathname="/tickets" />);
    const headers = [...container.querySelectorAll("th")];
    expect(headers).toHaveLength(6);
    expect(headers.every((th) => th.textContent === "" && th.querySelector(".internal-page-skeleton-bar"))).toBe(true);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(7);
    expect(container.querySelector(".route-skeleton-ticket-search")).toBeTruthy();
    expect(container.querySelectorAll(".route-skeleton-ticket-action")).toHaveLength(2);
    expect(container.querySelector(".route-skeleton-metrics, .internal-page-skeleton-cards")).toBeNull();
  });

  it("gives Dashboard metric cards and panels, All Conversations a split pane, Settings a form", () => {
    const dashboard = render(<RouteSkeleton pathname="/dashboard" />).container;
    expect(dashboard.querySelectorAll(".route-skeleton-metrics > .route-skeleton-panel")).toHaveLength(4);
    expect(dashboard.querySelector(".route-skeleton-table")).toBeNull();
    cleanup();

    const conversations = render(<RouteSkeleton pathname="/team/all-conversations" />).container;
    // The real workspace markup: employees, conversations, and an empty transcript pane.
    const panes = conversations.querySelector("[data-view='employees']");
    expect(panes?.children).toHaveLength(3);
    expect(panes?.children[0]?.querySelectorAll(".internal-page-skeleton-bar").length).toBeGreaterThan(7);
    expect(panes?.children[2]?.children).toHaveLength(0);
    expect(conversations.textContent).toBe("Loading page");
    expect(conversations.querySelector(".route-skeleton-metrics, .internal-page-skeleton-cards")).toBeNull();
    cleanup();

    const settings = render(<RouteSkeleton pathname="/settings/general" />).container;
    expect(settings.querySelector(".settings-page-layout .route-skeleton-nav")).toBeTruthy();
    expect(settings.querySelectorAll(".route-skeleton-fields > div").length).toBeGreaterThan(2);
    expect(settings.querySelector(".route-skeleton-table, table")).toBeNull();
  });

  it("renders exactly one loading status per skeleton, with decorative parts hidden and nothing focusable", () => {
    for (const path of ["/dashboard", "/orders", "/tickets", "/reporting", "/clients", "/todo", "/invoices", "/subscriptions", "/coupons", "/investment-intent", "/services", "/forms", "/team", "/team/all-conversations", "/settings", "/nowhere"]) {
      const { container } = render(<RouteSkeleton pathname={path} />);
      const statuses = screen.getAllByRole("status");
      expect(statuses, path).toHaveLength(1);
      expect(statuses[0]?.querySelector(".sr-only")?.textContent, path).toBe("Loading page");
      expect(container.querySelector("[data-skeleton] > [aria-hidden='true']"), path).toBeTruthy();
      expect(container.querySelector("h1, a[href], button, input, [tabindex]"), path).toBeNull();
      // Shapes only: no visible text that could read as the previous or loaded page.
      expect(container.querySelector("[data-skeleton] > [aria-hidden='true']")?.textContent, path).toBe("");
      cleanup();
    }
  });

  it("routes the (internal) loading boundary through the same resolver", () => {
    nav.pathname = "/team/all-conversations";
    const { container } = render(<InternalLoading />);
    expect(container.querySelector("[data-skeleton]")?.getAttribute("data-skeleton")).toBe("conversations");
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

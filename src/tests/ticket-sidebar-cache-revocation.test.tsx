/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClientPortalSidebar } from "../components/account/client-portal-sidebar";
import { portalNavigationFor } from "../components/account/portal-nav-registry";
import { notifyTicketAccessUnavailable } from "../components/tickets/ticket-access-boundary";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));
afterEach(cleanup);

it("hides the cached Ticket waiting count on denial before refresh while preserving independent Project counts", () => {
  const categories = portalNavigationFor({ portal_tickets: true, portal_projects: true }, { messages: 3, projects: 2, onboarding: null });
  const view = render(<ClientPortalSidebar categories={categories} companyName="Synthetic client" displayName="Synthetic" />);
  expect(view.getByText("3 waiting on you")).toBeTruthy();
  act(() => notifyTicketAccessUnavailable("denied-ticket"));
  expect(view.queryByText("3 waiting on you")).toBeNull();
  expect(view.getByText("2 in progress")).toBeTruthy();
  const refreshed = portalNavigationFor({ portal_tickets: true, portal_projects: true }, { messages: 1, projects: 2, onboarding: null });
  view.rerender(<ClientPortalSidebar categories={refreshed} companyName="Synthetic client" displayName="Synthetic" />);
  expect(view.getByText("1 waiting on you")).toBeTruthy();
});

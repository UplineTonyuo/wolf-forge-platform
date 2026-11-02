/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";

afterEach(cleanup);
describe("annotated record destinations", () => {
  it.each([
    ["/orders/one", "projectDetail"], ["/tickets/one", "ticketDetail"],
    ["/reporting/one", "reportDetail"], ["/invoices/one", "invoiceDetail"],
    ["/invoices/one/edit", "invoiceEditor"], ["/invoices/new", "invoiceEditor"],
    ["/subscriptions/one", "subscriptionDetail"],
    ["/coupons/new", "couponEditor"], ["/coupons/one", "couponEditor"],
    ["/services/new?folder=one", "serviceEditor"],
  ])("%s uses %s rather than a generic list", (path, variant) => {
    expect(getInternalSkeletonVariant(path)).toBe(variant);
    const { container } = render(<RouteSkeleton pathname={path} />);
    expect(container.querySelector(`[data-skeleton="${variant}"]`)).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector("button, input, a[href], [tabindex]")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
  });
  it("Ticket detail reserves a queue and management pane, without a fake conversation", () => {
    const { container } = render(<RouteSkeleton pathname="/tickets/one" />);
    expect(container.querySelector('[data-skeleton-block="ticket-management"]')).not.toBeNull();
    expect(container.querySelector('[data-skeleton-block="ticket-queue"]')).not.toBeNull();
    expect(container.querySelector('[data-skeleton-block="project-conversation"]')).toBeNull();
  });
});

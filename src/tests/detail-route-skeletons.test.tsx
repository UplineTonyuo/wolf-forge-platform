/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";
import invoice from "../components/invoices/invoice-admin.module.css";
import report from "../components/reporting/reporting.module.css";
import order from "../components/projects/project-detail.module.css";

afterEach(cleanup);
describe("annotated record destinations", () => {
  it.each(["/invoices/new", "/invoices/one/edit"])("%s reserves an item-entry card, not a read-only table", path => {
    const { container } = render(<RouteSkeleton pathname={path} />);
    const item = container.querySelector(`.${invoice.itemEditor} .${invoice.itemRow}`);
    expect(item).not.toBeNull();
    expect(item?.querySelector(`.${invoice.itemFields} .${invoice.descriptionField}`)).not.toBeNull();
    expect(container.querySelector(".route-skeleton-table")).toBeNull();
    expect(container.querySelector(`.${invoice.preview}`)).not.toBeNull();
  });
  it("does not pretend an unknown report is a guided editable form", () => {
    const { container } = render(<RouteSkeleton pathname="/reporting/one" />);
    expect(container.querySelector(`.${report.identity}`)).not.toBeNull();
    expect(container.querySelector(`.${report.wizardActions}, .${report.wizardStage}, .route-skeleton-fields`)).toBeNull();
  });
  it("reserves Back, three Order sections and the right-hand control region", () => {
    const { container } = render(<RouteSkeleton pathname="/orders/one" />);
    const left = container.querySelector(`.${order.subnavLeft}`);
    expect(left?.children).toHaveLength(2);
    expect(left?.querySelector(`.${order.tabs}`)?.children).toHaveLength(3);
    expect(container.querySelector(`.${order.headerControls}`)?.children).toHaveLength(3);
  });
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

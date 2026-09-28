/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSubscriptionDetail, ClientSubscriptionsList } from "../components/subscriptions/client-subscriptions";
import { availableSubscriptionActions, SubscriptionActions } from "../components/subscriptions/subscription-actions";
import { SubscriptionDetailView, type SubscriptionInvoiceView } from "../components/subscriptions/subscription-detail";
import { SubscriptionsList } from "../components/subscriptions/subscriptions-list";
import type { SubscriptionCapabilities, SubscriptionDetail, SubscriptionSummary } from "../domain/subscriptions/schema";

const actionMocks = vi.hoisted(() => ({
  pause: vi.fn(), resume: vi.fn(), schedule: vi.fn(), remove: vi.fn(), cancel: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: vi.fn() }));
/* The portal calendar trigger imports a "use server" module; vitest cannot resolve server-only. */
vi.mock("../app/actions/subscription-calendar", () => ({
  loadClientSubscriptionCalendarAction: vi.fn(async () => ({ ok: true, sources: [] })),
  loadOwnerSubscriptionCalendarAction: vi.fn(async () => ({ ok: true, sources: [] })),
}));
vi.mock("../app/actions/subscriptions", () => ({
  pauseSubscriptionAction: actionMocks.pause,
  resumeSubscriptionAction: actionMocks.resume,
  scheduleSubscriptionCancellationAction: actionMocks.schedule,
  removeSubscriptionCancellationAction: actionMocks.remove,
  cancelSubscriptionAction: actionMocks.cancel,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  Object.values(actionMocks).forEach((mock) => mock.mockResolvedValue({ ok: true }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseSummary: SubscriptionSummary = {
  subscription_id: "11111111-1111-4111-8111-111111111111",
  public_ref: "WF-A13C9F2B",
  company_id: "22222222-2222-4222-8222-222222222222",
  company_name: "Northpoint Logistics",
  client_profile_id: null,
  service_id: "33333333-3333-4333-8333-333333333333",
  service_name: "SEO Success Blueprint",
  status: "active",
  health: "active",
  paid_cycle_count: 4,
  last_payment_at: "2026-07-20T10:00:00Z",
  next_payment_on: "2026-08-20",
  amount_cents: 80_730,
  currency: "USD",
  interval_unit: "month",
  interval_count: 1,
};

const pastDueSummary: SubscriptionSummary = {
  ...baseSummary,
  subscription_id: "44444444-4444-4444-8444-444444444444",
  public_ref: "WF-B22D8E3C",
  company_name: "Summit Financial Group",
  status: "past_due",
  health: "requires_attention",
};

const invoice: SubscriptionInvoiceView = {
  id: "55555555-5555-4555-8555-555555555555",
  invoiceNumber: 1260,
  status: "unpaid",
  presentationState: "overdue",
  totalCents: 80_730,
  currency: "USD",
  dueAt: "2026-08-20T15:59:59Z",
};

const detail = {
  subscription: {
    id: baseSummary.subscription_id,
    company_id: baseSummary.company_id,
    client_profile_id: null,
    service_id: baseSummary.service_id,
    public_ref: baseSummary.public_ref,
    status: "active",
    plan_source: "admin_invoice",
    billing_anchor: "2026-05-20",
    current_period_end: "2026-09-20",
    current_plan_version_id: "66666666-6666-4666-8666-666666666666",
    started_at: "2026-05-20T10:00:00Z",
    paused_at: null,
    resumes_at: null,
    cancel_effective_at: null,
    canceled_at: null,
    cancellation_reason: null,
    external_processor: null,
    external_processor_reference: null,
    created_by_profile_id: "77777777-7777-4777-8777-777777777777",
    updated_by_profile_id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    archived_at: null,
  },
  current_plan: {
    id: "66666666-6666-4666-8666-666666666666",
    subscription_id: baseSummary.subscription_id,
    version: 2,
    effective_from: "2026-07-20",
    interval_unit: "month",
    interval_count: 1,
    anchor_day: 20,
    end_of_month_policy: "clamp",
    currency: "USD",
    lead_days: 5,
    grace_days: 15,
    recurring_action: "none",
    request_limit_total: null,
    request_limit_active: null,
    created_by_profile_id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-07-20T10:00:00Z",
  },
  plan_items: [{
    id: "88888888-8888-4888-8888-888888888888",
    plan_version_id: "66666666-6666-4666-8666-666666666666",
    position: 0,
    service_id: baseSummary.service_id,
    service_name_snapshot: baseSummary.service_name,
    service_description_snapshot: "A durable commercial snapshot.",
    quantity: 1,
    unit_amount_cents: 89_700,
    unit_discount_cents: 8_970,
    coupon_id: null,
    coupon_recurring_duration: null,
    is_taxable: true,
    created_at: "2026-07-20T10:00:00Z",
  }],
  cycles: [{
    id: "99999999-9999-4999-8999-999999999999",
    sequence: 2,
    period_start: "2026-08-20",
    period_end: "2026-09-20",
    due_on: "2026-08-20",
    issue_on: "2026-08-15",
    status: "past_due",
    invoice_id: invoice.id,
    generated_at: "2026-08-15T00:00:00Z",
    settled_at: null,
    fulfillment_status: "not_ready",
  }],
  events: [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    subscription_id: baseSummary.subscription_id,
    cycle_id: "99999999-9999-4999-8999-999999999999",
    event_type: "invoice_generated",
    actor_type: "system",
    actor_profile_id: null,
    payload: { invoice_id: invoice.id },
    occurred_at: "2026-08-15T00:00:00Z",
  }],
} as SubscriptionDetail;

const capabilities: SubscriptionCapabilities = { view: true, manage: true, pause: true, cancel: true, billing: true };

describe("Subscriptions admin list", () => {
  it("renders real summaries with formatted amount, interval, payments, and health", () => {
    render(<SubscriptionsList summaries={[baseSummary, pastDueSummary]} canManage />);
    expect(screen.getAllByText("WF-A13C9F2B").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$807.30").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Filter subscriptions" })).toBeInTheDocument();
  });

  it("filters by status in the shared sheet and instant search", () => {
    render(<SubscriptionsList summaries={[baseSummary, pastDueSummary]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Filter subscriptions" }));
    fireEvent.click(screen.getByRole("button", { name: /Past Due\s*1/i }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getAllByText("WF-B22D8E3C").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-A13C9F2B")).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText(/Search reference/i), { target: { value: "no result" } });
    expect(screen.getByText("No subscriptions match your search.")).toBeInTheDocument();
  });

  it("keeps the Health and Interval filters in the shared sheet", () => {
    const pausedSummary: SubscriptionSummary = {
      ...baseSummary,
      subscription_id: "88888888-8888-4888-8888-888888888888",
      public_ref: "WF-C33E9F4D",
      company_name: "Quiet Harbour Media",
      status: "paused",
      health: "stalled",
      interval_unit: "year",
    };
    render(<SubscriptionsList summaries={[baseSummary, pastDueSummary, pausedSummary]} canManage />);

    fireEvent.click(screen.getByRole("button", { name: "Filter subscriptions" }));
    fireEvent.click(screen.getByRole("button", { name: /^All\s*3$/u }));
    fireEvent.click(screen.getByRole("button", { name: "Stalled" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getAllByText("WF-C33E9F4D").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-A13C9F2B")).toHaveLength(0);
    expect(screen.queryAllByText("WF-B22D8E3C")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Filter subscriptions" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getAllByText("WF-A13C9F2B").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Filter subscriptions" }));
    fireEvent.click(screen.getByRole("button", { name: /^All\s*3$/u }));
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getAllByText("WF-C33E9F4D").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-B22D8E3C")).toHaveLength(0);
  });

  it("renders an intentional empty state", () => {
    render(<SubscriptionsList summaries={[]} canManage />);
    expect(screen.getByText("No Active subscriptions.")).toBeInTheDocument();
  });
});

describe("Subscription admin detail", () => {
  it("shows summary and snapshot terms with clean punctuation and readable captured HTML", () => {
    const htmlDetail = {
      ...detail,
      plan_items: [{ ...detail.plan_items[0]!, service_description_snapshot: "<div>✅ Google My Business optimization&nbsp;</div><div>GMB Photos<br>GBP Posts</div><script>alert(1)</script>" }],
    };
    const { container } = render(<SubscriptionDetailView detail={htmlDetail} summary={pastDueSummary} invoices={[invoice]} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Subscription summary" })).toBeInTheDocument();
    expect(screen.getByText("Summit Financial Group")).toBeInTheDocument();
    expect(screen.getByText("Sep 20, 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$807.30").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Current plan · Version 2" })).toBeInTheDocument();
    expect(screen.getByText("5 days")).toBeInTheDocument();
    expect(screen.getByText("15 days")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("$897.00")).toBeInTheDocument();
    expect(screen.getByText("$89.70")).toBeInTheDocument();
    expect(screen.getByText("✅ Google My Business optimization")).toBeInTheDocument();
    expect(screen.getByText("GMB Photos")).toBeInTheDocument();
    expect(screen.getByText("GBP Posts")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Â|â€“|â€”|Ã|�|<div|&nbsp;|<br|alert\(1\)/u);
  });

  it("switches through billing, invoices, and history with real values and links", () => {
    render(<SubscriptionDetailView detail={detail} summary={pastDueSummary} invoices={[invoice]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Billing" }));
    expect(screen.getByRole("heading", { name: "Billing cycle 2" })).toBeInTheDocument();
    expect(screen.getByText("Aug 20, 2026 – Sep 20, 2026")).toBeInTheDocument();
    expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("Not Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WF-1260" })).toHaveAttribute("href", `/invoices/${invoice.id}`);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Billing" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Invoices" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Due Aug 20, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /WF-1260/ })).toHaveAttribute("href", `/invoices/${invoice.id}`);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Invoice generated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WF-1260" })).toBeInTheDocument();
    expect(screen.getByText(/Billing cycle event/)).toBeInTheDocument();
  });

  it("shows empty invoice and event states", () => {
    render(<SubscriptionDetailView detail={{ ...detail, events: [] }} summary={baseSummary} invoices={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Invoices" }));
    expect(screen.getByText("No invoices generated yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("No internal events are available.")).toBeInTheDocument();
  });

  it("offers only lifecycle actions valid for the current status", () => {
    expect(availableSubscriptionActions("active", capabilities)).toMatchObject({ pause: true, resume: false, schedule: true, remove: false, cancel: true });
    expect(availableSubscriptionActions("paused", capabilities)).toMatchObject({ pause: false, resume: true, schedule: false, cancel: true });
    expect(availableSubscriptionActions("pending_cancellation", capabilities)).toMatchObject({ remove: true, pause: false, schedule: false });
    expect(availableSubscriptionActions("canceled", capabilities)).toMatchObject({ edit: false, pause: false, resume: false, schedule: false, remove: false, cancel: false });
  });
});

describe("Subscription lifecycle actions", () => {
  it("calls Pause with the server-authoritative optional resume date", async () => {
    render(<SubscriptionActions subscriptionId={baseSummary.subscription_id} status="active" capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByLabelText("On date"));
    fireEvent.change(screen.getByLabelText("Resume date"), { target: { value: "2027-01-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Pause Subscription" }));
    await waitFor(() => expect(actionMocks.pause).toHaveBeenCalledWith(baseSummary.subscription_id, "2027-01-15"));
  });

  it.each([
    ["paused", "Resume", "Resume Subscription", actionMocks.resume],
    ["pending_cancellation", "Keep Subscription Active", "Keep Subscription Active", actionMocks.remove],
  ] as const)("wires the %s transition", async (status, opener, confirm, mock) => {
    render(<SubscriptionActions subscriptionId={baseSummary.subscription_id} status={status} capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: opener }));
    const buttons = screen.getAllByRole("button", { name: confirm });
    fireEvent.click(buttons[buttons.length - 1] as HTMLButtonElement);
    await waitFor(() => expect(mock).toHaveBeenCalled());
  });

  it("wires scheduled cancellation and immediate cancellation", async () => {
    render(<SubscriptionActions subscriptionId={baseSummary.subscription_id} status="active" capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel at period end" }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Budget change" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Cancellation" }));
    await waitFor(() => expect(actionMocks.schedule).toHaveBeenCalledWith(baseSummary.subscription_id, "Budget change"));
    cleanup();
    render(<SubscriptionActions subscriptionId={baseSummary.subscription_id} status="active" capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel now" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Subscription" }));
    await waitFor(() => expect(actionMocks.cancel).toHaveBeenCalled());
  });

  it("surfaces backend transition errors without raw SQL", async () => {
    actionMocks.pause.mockResolvedValueOnce({ ok: false, error: "Subscription cannot be paused from its current state." });
    render(<SubscriptionActions subscriptionId={baseSummary.subscription_id} status="active" capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause Subscription" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be paused");
  });
});

describe("Client Subscription portal", () => {
  it("renders the company-scoped list with price, frequency, and dates", () => {
    render(<ClientSubscriptionsList summaries={[baseSummary]} />);
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByText("SEO Success Blueprint")).toBeInTheDocument();
    expect(screen.getByText("$807.30")).toBeInTheDocument();
  });

  it("speaks client billing language rather than internal billing language", () => {
    render(<ClientSubscriptionsList summaries={[baseSummary]} />);

    expect(screen.getByText("Monthly investment")).toBeInTheDocument();
    expect(screen.queryByText(/spend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plan version/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recurring fulfillment/i)).not.toBeInTheDocument();
  });

  it("renders a simple own-Subscription detail without internal controls or processor metadata", () => {
    render(<ClientSubscriptionDetail detail={detail} summary={{ ...pastDueSummary, service_name: baseSummary.service_name }} invoices={[invoice]} />);
    expect(screen.getByText("A payment is due on this subscription.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View the open invoice/ })).toHaveAttribute("href", `/account/invoices/${invoice.id}`);
    expect(screen.queryByText("Edit plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.queryByText(/processor/i)).not.toBeInTheDocument();
    /* Internal health vocabulary must not reach a client. */
    expect(screen.queryByText(/lead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/grace/i)).not.toBeInTheDocument();
  });
});

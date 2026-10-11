/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientDashboard } from "../components/account/dashboard/client-dashboard";
import { ClientOnboardingView } from "../components/account/onboarding/client-onboarding";
import { ClientInvoicesView } from "../components/account/billing/client-invoices";
import { composeClientOnboarding } from "../domain/client-portal/onboarding";
import { resolveWalletFunding } from "../domain/client-portal/payment-method";
import { composeClientPortalSummary } from "../domain/client-portal/summary";
import { composeClientPaymentRails } from "../domain/payments/payment-rails";
import type { FormAssignmentSummary } from "../domain/forms/schema";
import type { ClientProjectView } from "../domain/orders/client-projections";
import type { SubscriptionSummary } from "../domain/subscriptions/schema";
import type { ClientTicketSummary } from "../domain/tickets/schema";
import type { ClientInvoiceSummary } from "../repositories/invoice-repository";

afterEach(cleanup);

/**
 * The shipped rail configuration.
 *
 * Wolf Forge Balance is real and default; PayPal and bank transfer are the two
 * external rails Wolf Forge has not connected. Composed through the domain so
 * these assertions follow any change to how a rail is built.
 */
const portalRails = composeClientPaymentRails({
  wallet: resolveWalletFunding({
    membershipStatus: "active",
    balanceCents: 50_000,
    currency: "USD",
  }),
  availability: { paypal: "not_connected", bank_transfer: "not_configured" },
});


/* The wallet card reads prefers-reduced-motion, which jsdom does not implement. */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const NOW = new Date("2026-08-18T00:00:00.000Z");

it("preserves paused assignment status while removing actionable reminders", () => {
  const paused = assignment({ work_enabled: false });
  const model = composeClientOnboarding([paused]);
  expect(model.groups[0]!.items[0]!.action).toBe("Paused");
  expect(model.outstanding).toHaveLength(0);
  expect(model.progress).toEqual({ completed: 0, total: 1 });
  expect(paused.status).toBe("assigned");
  render(<ClientOnboardingView onboarding={model} />);
  expect(screen.getByText("Collection paused")).toBeInTheDocument();
  expect(screen.getByText(/Outstanding requests are retained/)).toBeInTheDocument();
  expect(screen.queryByText(/caught up/)).not.toBeInTheDocument();
});

function assignment(overrides: Partial<FormAssignmentSummary> = {}): FormAssignmentSummary {
  return {
    assignment_id: "assignment-1",
    form_id: "form-1",
    form_type: "onboarding",
    form_version_id: "version-1",
    version_number: 1,
    title: "Business information",
    status: "assigned",
    required: true,
    due_at: null,
    assigned_at: "2026-08-10T00:00:00.000Z",
    completed_at: null,
    company_id: "company-private",
    company_name: "Acme",
    client_profile_id: "client-private",
    client_name: "Jane Client",
    order_id: null,
    order_number: null,
    order_title: null,
    latest_submission_id: null,
    ...overrides,
  };
}

function project(overrides: Partial<ClientProjectView> = {}): ClientProjectView {
  return {
    id: "project-1",
    reference: "WF-P0001",
    title: "Local SEO launch",
    status: "working",
    statusLabel: "Working",
    serviceName: "Local SEO",
    createdLabel: "1 Aug 2026",
    dueLabel: null,
    startedLabel: "5 Aug 2026",
    completedLabel: null,
    progress: { total: 4, completed: 1, percent: 25 },
    ...overrides,
  };
}

function ticket(overrides: Partial<ClientTicketSummary> = {}): ClientTicketSummary {
  return {
    ticket_id: "ticket-1",
    public_ref: "WF-TKT-000001",
    subject: "Homepage copy",
    status: "waiting_on_client",
    message_count: 3,
    last_message_at: "2026-08-17T09:00:00.000Z",
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-17T09:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

function invoiceSummary(
  overrides: {
    id?: string;
    currency?: string;
    total?: number;
    balance?: number;
    state?: string;
    overdue?: boolean;
  } = {},
): ClientInvoiceSummary {
  return {
    invoice: {
      id: overrides.id ?? "invoice-1",
      currency: overrides.currency ?? "USD",
      total_cents: overrides.total ?? 245_000,
      due_at: null,
      created_at: "2026-08-01T00:00:00.000Z",
      invoice_number: 12,
    } as ClientInvoiceSummary["invoice"],
    financials: {
      presentation_state: overrides.state ?? "unpaid",
      balance_due_cents: overrides.balance ?? 245_000,
      is_overdue: overrides.overdue ?? false,
    } as ClientInvoiceSummary["financials"],
  };
}

function subscription(overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    subscription_id: "sub-1",
    public_ref: "SUBREF000001",
    company_id: "company-private",
    company_name: "Acme",
    client_profile_id: "client-private",
    service_id: "service-1",
    service_name: "Local SEO retainer",
    status: "active",
    health: "active",
    paid_cycle_count: 3,
    last_payment_at: "2026-07-18T00:00:00.000Z",
    next_payment_on: "2026-09-18",
    amount_cents: 120_000,
    currency: "USD",
    interval_unit: "month",
    interval_count: 1,
    ...overrides,
  };
}

const emptySources = {
  projects: null,
  assignments: null,
  invoices: null,
  tickets: null,
  subscriptions: null,
};

describe("client dashboard summary", () => {
  it("surfaces every real reason the client is blocking, and nothing else", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [project({ status: "waiting_reply" }), project({ id: "p2", status: "working" })],
        assignments: [assignment()],
        invoices: [invoiceSummary({ overdue: true, state: "overdue" })],
        tickets: [ticket()],
        subscriptions: [subscription()],
      },
      NOW,
    );

    expect(summary.attention.map((item) => item.id)).toEqual([
      "onboarding",
      "messages",
      "projects",
      "invoices",
    ]);
    expect(summary.counts).toEqual({ onboarding: 1, messages: 1, projects: 2 });
  });

  it("has no attention items when nothing is waiting on the client", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [project({ status: "working" })],
        assignments: [assignment({ status: "completed", completed_at: "2026-08-12T00:00:00Z" })],
        invoices: [invoiceSummary({ state: "paid", balance: 0 })],
        tickets: [ticket({ status: "in_progress" })],
        subscriptions: [subscription()],
      },
      NOW,
    );

    expect(summary.attention).toEqual([]);
    expect(summary.counts.onboarding).toBe(0);
    expect(summary.counts.messages).toBe(0);
    expect(summary.isBrandNew).toBe(false);
  });

  it("reports a denied module as absent rather than empty", () => {
    const summary = composeClientPortalSummary(
      { ...emptySources, projects: [project()] },
      NOW,
    );

    expect(summary.balance).toBeNull();
    expect(summary.activeSubscriptionCount).toBeNull();
    expect(summary.onboarding).toBeNull();
    expect(summary.messagesGranted).toBe(false);
    expect(summary.counts).toEqual({ onboarding: null, messages: null, projects: 1 });
  });

  it("identifies a brand-new account with nothing at all", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [],
        assignments: [],
        invoices: [],
        tickets: [],
        subscriptions: [],
      },
      NOW,
    );

    expect(summary.isBrandNew).toBe(true);
  });

  it("picks the earliest real next billing date and ignores canceled subscriptions", () => {
    const summary = composeClientPortalSummary(
      {
        ...emptySources,
        subscriptions: [
          subscription({ subscription_id: "late", next_payment_on: "2026-12-01" }),
          subscription({ subscription_id: "soon", next_payment_on: "2026-09-01" }),
          subscription({
            subscription_id: "gone",
            status: "canceled",
            next_payment_on: "2026-08-20",
          }),
          subscription({ subscription_id: "unscheduled", next_payment_on: null }),
        ],
      },
      NOW,
    );

    expect(summary.nextBilling?.href).toBe("/account/subscriptions/soon");
  });

  it("returns no next billing date when the engine has scheduled none", () => {
    const summary = composeClientPortalSummary(
      { ...emptySources, subscriptions: [subscription({ next_payment_on: null })] },
      NOW,
    );

    expect(summary.nextBilling).toBeNull();
  });

  it("orders active work so blocked projects come first", () => {
    const summary = composeClientPortalSummary(
      {
        ...emptySources,
        projects: [
          project({ id: "a", status: "working", title: "Running" }),
          project({ id: "b", status: "pending_update", title: "Blocked" }),
        ],
      },
      NOW,
    );

    expect(summary.activeProjects.map((entry) => entry.title)).toEqual(["Blocked", "Running"]);
    expect(summary.activeProjects[0]?.toneLabel).toBe("Needs information");
  });

  it("points conversations at the Messages routes", () => {
    const summary = composeClientPortalSummary({ ...emptySources, tickets: [ticket()] }, NOW);

    expect(summary.recentMessages[0]?.href).toBe("/account/messages/ticket-1");
  });
});

describe("client dashboard rendering", () => {
  const summaryWithEverything = () =>
    composeClientPortalSummary(
      {
        projects: [project({ status: "waiting_reply" })],
        assignments: [assignment()],
        invoices: [invoiceSummary()],
        tickets: [ticket()],
        subscriptions: [subscription()],
      },
      NOW,
    );

  it("renders real data and never a fabricated payment method", () => {
    render(
      <ClientDashboard
        companyName="Acme"
        displayName="Jane Client"
        summary={summaryWithEverything()}
        paymentRails={portalRails}
        storeGranted
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome back, Jane" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs your attention" })).toBeInTheDocument();
    // The figure appears both in the balance card and in the attention row.
    expect(screen.getAllByText("$2,450.00").length).toBeGreaterThan(0);

    // The account's real default rail, named, with its real balance.
    expect(screen.getByText("Wolf Forge Balance")).toBeInTheDocument();
    expect(screen.getByText("$500.00 available")).toBeInTheDocument();
    expect(screen.queryByText("No payment method on file")).not.toBeInTheDocument();
    expect(screen.queryByText(/4242/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Visa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mastercard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expires/i)).not.toBeInTheDocument();
  });

  it("shows an intentional caught-up state rather than an empty figure", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [project({ status: "complete" })],
        assignments: [],
        invoices: [invoiceSummary({ state: "paid", balance: 0 })],
        tickets: [],
        subscriptions: [],
      },
      NOW,
    );

    render(
      <ClientDashboard
        companyName="Acme"
        displayName={null}
        summary={summary}
        paymentRails={portalRails}
        storeGranted={false}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Needs your attention" })).not.toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("You’re all caught up.")).toBeInTheDocument();
  });

  it("renders one welcome state for a brand-new account, not a page of empty cards", () => {
    const summary = composeClientPortalSummary(
      { projects: [], assignments: [], invoices: [], tickets: [], subscriptions: [] },
      NOW,
    );

    render(
      <ClientDashboard
        companyName="Acme"
        displayName="Jane Client"
        summary={summary}
        paymentRails={portalRails}
        storeGranted
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse services/ })).toHaveAttribute(
      "href",
      "/account/store",
    );

    // No billing, no work sections, no zero tiles.
    expect(screen.queryByText("Outstanding balance")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Active work" })).not.toBeInTheDocument();
  });

  it("omits sections for modules the account does not hold", () => {
    const summary = composeClientPortalSummary(
      { ...emptySources, projects: [project()] },
      NOW,
    );

    render(
      <ClientDashboard
        companyName="Acme"
        displayName="Jane Client"
        summary={summary}
        /* Invoices denied, so the rails read null exactly as the loader returns. */
        paymentRails={null}
        storeGranted={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Active work" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Billing" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recent conversations" }),
    ).not.toBeInTheDocument();
  });

  it("shows each currency separately and never a combined total", () => {
    const summary = composeClientPortalSummary(
      {
        ...emptySources,
        invoices: [
          invoiceSummary({ id: "usd", currency: "USD", balance: 100_000 }),
          invoiceSummary({ id: "eur", currency: "EUR", balance: 250_000 }),
        ],
      },
      NOW,
    );

    render(
      <ClientDashboard
        companyName="Acme"
        displayName="Jane Client"
        summary={summary}
        paymentRails={portalRails}
        storeGranted={false}
      />,
    );

    expect(screen.getByText("€2,500.00")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    // 350,000 cents in either symbol would be the fabricated sum.
    expect(screen.queryByText("$3,500.00")).not.toBeInTheDocument();
    expect(screen.queryByText("€3,500.00")).not.toBeInTheDocument();
  });
});

describe("client onboarding", () => {
  it("counts completion from the status the database actually writes", () => {
    /*
     * app_submit_form writes 'completed'. The read model previously compared
     * against "submitted", so a finished item never counted.
     */
    const onboarding = composeClientOnboarding([
      assignment({ assignment_id: "a", status: "completed", completed_at: "2026-08-12T00:00:00Z" }),
      assignment({ assignment_id: "b", status: "assigned" }),
      assignment({ assignment_id: "c", status: "assigned" }),
    ]);

    expect(onboarding.progress).toEqual({ completed: 1, total: 3 });
    expect(onboarding.outstanding.map((item) => item.assignmentId)).toEqual(["b", "c"]);
  });

  it("excludes archived and canceled assignments from the denominator", () => {
    const onboarding = composeClientOnboarding([
      assignment({ assignment_id: "a", status: "assigned" }),
      assignment({ assignment_id: "b", status: "archived" }),
      assignment({ assignment_id: "c", status: "canceled" }),
    ]);

    expect(onboarding.progress).toEqual({ completed: 0, total: 1 });
  });

  it("reports no progress at all when there is nothing to measure", () => {
    expect(composeClientOnboarding([]).progress).toBeNull();
  });

  it("separates account setup from project information", () => {
    const onboarding = composeClientOnboarding([
      assignment({ assignment_id: "a", form_type: "onboarding" }),
      assignment({
        assignment_id: "b",
        form_type: "intake",
        order_id: "order-1",
        order_title: "Local SEO launch",
      }),
    ]);

    expect(onboarding.groups.map((group) => group.id)).toEqual(["account", "project"]);
    expect(onboarding.groups[0]?.items[0]?.context).toBe("Account setup");
    expect(onboarding.groups[1]?.items[0]?.context).toBe("Local SEO launch");
  });

  it("chooses the CTA from the item's real state", () => {
    const onboarding = composeClientOnboarding([
      assignment({ assignment_id: "a", status: "assigned" }),
      assignment({ assignment_id: "b", status: "assigned", latest_submission_id: "sub-1" }),
      assignment({ assignment_id: "c", status: "completed" }),
    ]);

    expect(onboarding.groups[0]?.items.map((item) => item.action)).toEqual([
      "Start",
      "Continue",
      "View",
    ]);
  });

  it("renders assigned items without leaking internal identity", () => {
    render(
      <ClientOnboardingView
        onboarding={composeClientOnboarding([assignment({ title: "Brand assets" })])}
      />,
    );

    expect(screen.getByText("Brand assets")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 completed")).toBeInTheDocument();
    expect(screen.queryByText("Jane Client")).not.toBeInTheDocument();
    expect(screen.queryByText("company-private")).not.toBeInTheDocument();
    expect(screen.queryByText("client-private")).not.toBeInTheDocument();
  });

  it("shows a real empty state, not a zero-of-zero progress line", () => {
    render(<ClientOnboardingView onboarding={composeClientOnboarding([])} />);

    expect(screen.queryByText(/0 of 0 completed/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing is required from you yet/)).toBeInTheDocument();
  });

  it("links each item to its own onboarding route", () => {
    render(
      <ClientOnboardingView
        onboarding={composeClientOnboarding([assignment({ assignment_id: "abc" })])}
      />,
    );

    expect(screen.getByRole("link", { name: /Business information/ })).toHaveAttribute(
      "href",
      "/account/onboarding/abc",
    );
  });
});

describe("client invoice rows", () => {
  it("groups the icon with the title and the issued/due line beneath it", () => {
    const { container } = render(
      <ClientInvoicesView invoices={[invoiceSummary({ id: "one" })]} />,
    );

    const title = container.querySelector(".portal-invoice-title");
    const sub = container.querySelector(".portal-invoice-sub");

    // Icon and number share the title line; the meta line is its own sibling,
    // so it hangs under the title rather than under the glyph.
    expect(title?.querySelector("svg")).not.toBeNull();
    expect(title?.querySelector("strong")?.textContent).toBe("Invoice #WF-0012");
    expect(sub?.textContent).toContain("Issued");

    // No plate, pill or border around the mark.
    const icon = title!.querySelector("svg")!;
    expect(icon.closest("[class*='pill']")).toBeNull();
    expect(icon.parentElement).toBe(title);
  });

  it("shows a single USD outstanding figure with no currency chip", () => {
    const { container } = render(
      <ClientInvoicesView
        invoices={[
          invoiceSummary({ id: "a", balance: 145_000 }),
          invoiceSummary({ id: "b", balance: 100_000 }),
        ]}
      />,
    );

    // The summed figure also appears on each row's total, so match the
    // headline figure inside the balance panel specifically.
    const balance = container.querySelector(".portal-balance")!;
    expect(within(balance as HTMLElement).getByText("$2,450.00")).toBeInTheDocument();
    // The currency-code chip only appears when more than one currency is owed.
    expect(container.querySelector(".portal-billing-currency-code")).toBeNull();
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
    expect(screen.queryByText("EUR")).not.toBeInTheDocument();
  });
});

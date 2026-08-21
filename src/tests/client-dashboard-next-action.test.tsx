/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientDashboard } from "../components/account/dashboard/client-dashboard";
import {
  activeProjectProgressState,
  composeAttentionChips,
  composeNextActionFlow,
} from "../domain/client-portal/next-action";
import { resolveWalletFunding } from "../domain/client-portal/payment-method";
import { composeClientPaymentRails } from "../domain/payments/payment-rails";
import { composeClientPortalSummary } from "../domain/client-portal/summary";
import type { FormAssignmentSummary } from "../domain/forms/schema";
import type { ClientProjectView } from "../domain/orders/client-projections";
import type { SubscriptionSummary } from "../domain/subscriptions/schema";
import type { ClientTicketSummary } from "../domain/tickets/schema";
import type { ClientInvoiceSummary } from "../repositories/invoice-repository";

/**
 * The Dashboard's next-action flow.
 *
 * The redesign changed presentation only, so these assertions are about
 * hierarchy and honesty: the most costly item is featured, every other real
 * action is still reachable at its real route, and no number appears that the
 * domain did not derive.
 */

afterEach(cleanup);

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
    title: "Google Business Profile optimisation",
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
  overrides: { currency?: string; balance?: number; state?: string; overdue?: boolean } = {},
): ClientInvoiceSummary {
  return {
    invoice: {
      id: "invoice-1",
      currency: overrides.currency ?? "USD",
      total_cents: 323_000,
      due_at: "2026-08-01T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      invoice_number: 12,
    } as ClientInvoiceSummary["invoice"],
    financials: {
      presentation_state: overrides.state ?? "overdue",
      balance_due_cents: overrides.balance ?? 323_000,
      is_overdue: overrides.overdue ?? true,
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

/** The four-item board described in the brief: onboarding, message, project, overdue invoice. */
function fullBoard() {
  return composeClientPortalSummary(
    {
      projects: [project({ status: "pending_update" }), project({ id: "project-2", reference: "WF-P0002", status: "working" })],
      assignments: [assignment()],
      invoices: [invoiceSummary()],
      tickets: [ticket()],
      subscriptions: [subscription()],
    },
    NOW,
  );
}

/** The shipped rail configuration, composed through the domain. */
const nextActionRails = composeClientPaymentRails({
  wallet: resolveWalletFunding({
    membershipStatus: "active",
    balanceCents: 50_000,
    currency: "USD",
  }),
  availability: { paypal: "not_connected", bank_transfer: "not_configured" },
});

function renderDashboard(summary: ReturnType<typeof composeClientPortalSummary>) {
  return render(
    <ClientDashboard
      companyName="Northgate Dental"
      displayName="Sarah Lane"
      summary={summary}
      paymentRails={nextActionRails}
      storeGranted={true}
    />,
  );
}

describe("next action priority", () => {
  it("features the overdue invoice above everything else", () => {
    const flow = composeNextActionFlow(fullBoard());

    expect(flow.featured?.id).toBe("invoices");
    expect(flow.featured?.urgent).toBe(true);
    expect(flow.featured?.eyebrow).toBe("Overdue");
  });

  it("orders the rest by what it costs the client", () => {
    const flow = composeNextActionFlow(fullBoard());

    expect(flow.all.map((action) => action.id)).toEqual([
      "invoices",
      "projects",
      "messages",
      "onboarding",
    ]);
  });

  it("drops an invoice that is owed but not yet late below the blocking work", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [project({ status: "pending_update" })],
        assignments: [assignment()],
        invoices: [invoiceSummary({ state: "unpaid", overdue: false })],
        tickets: [ticket()],
        subscriptions: null,
      },
      NOW,
    );

    const flow = composeNextActionFlow(summary);

    expect(flow.featured?.id).toBe("projects");
    expect(flow.all.at(-1)?.id).toBe("invoices");
    expect(flow.all.find((action) => action.id === "invoices")?.urgent).toBe(false);
  });

  it("features a waiting conversation when nothing is blocked or owed", () => {
    const summary = composeClientPortalSummary(
      { projects: [project()], assignments: null, invoices: null, tickets: [ticket()], subscriptions: null },
      NOW,
    );

    expect(composeNextActionFlow(summary).featured?.id).toBe("messages");
  });

  it("keeps a stable order for items of equal rank", () => {
    const summary = fullBoard();
    const first = composeNextActionFlow(summary).all.map((action) => action.id);
    const second = composeNextActionFlow(summary).all.map((action) => action.id);

    expect(second).toEqual(first);
  });
});

describe("next action honesty", () => {
  it("counts exactly what the domain derived, never a second tally", () => {
    const summary = fullBoard();
    const flow = composeNextActionFlow(summary);

    expect(flow.count).toBe(summary.attention.length);
    expect(flow.all).toHaveLength(summary.attention.length);
  });

  it("shows a single-currency figure and no combined total across currencies", () => {
    const single = composeNextActionFlow(
      composeClientPortalSummary(
        { projects: null, assignments: null, invoices: [invoiceSummary()], tickets: null, subscriptions: null },
        NOW,
      ),
    );

    expect(single.featured?.amountLabel).toBe("$3,230.00");

    const multi = composeNextActionFlow(
      composeClientPortalSummary(
        {
          projects: null,
          assignments: null,
          invoices: [invoiceSummary(), invoiceSummary({ currency: "GBP" })],
          tickets: null,
          subscriptions: null,
        },
        NOW,
      ),
    );

    // Two currencies cannot share one headline figure without inventing a rate.
    expect(multi.featured?.amountLabel).toBeNull();
  });

  it("adds no meta line when the data does not carry one", () => {
    const flow = composeNextActionFlow(
      composeClientPortalSummary(
        { projects: null, assignments: null, invoices: null, tickets: [ticket()], subscriptions: null },
        NOW,
      ),
    );

    expect(flow.featured?.id).toBe("messages");
    expect(flow.featured?.meta).toBeNull();
  });

  it("reports real onboarding progress and never a percentage", () => {
    const flow = composeNextActionFlow(
      composeClientPortalSummary(
        {
          projects: null,
          assignments: [assignment(), assignment({ assignment_id: "a2", status: "completed" })],
          invoices: null,
          tickets: null,
          subscriptions: null,
        },
        NOW,
      ),
    );

    const onboarding = flow.all.find((action) => action.id === "onboarding");
    expect(onboarding?.meta).toBe("1 of 2 complete");
    expect(onboarding?.meta).not.toMatch(/%/u);
  });

  it("names the blocked project rather than describing it generically", () => {
    const flow = composeNextActionFlow(fullBoard());
    const projects = flow.all.find((action) => action.id === "projects");

    expect(projects?.meta).toBe("WF-P0001");
  });
});

describe("attention chips", () => {
  it("only reports counts that are real and non-zero", () => {
    const chips = composeAttentionChips(fullBoard());

    expect(chips.map((chip) => chip.label)).toEqual([
      "1 overdue",
      "1 reply waiting",
      "2 projects active",
    ]);
  });

  it("produces no chip for a module the account does not hold", () => {
    const summary = composeClientPortalSummary(
      { projects: null, assignments: null, invoices: null, tickets: [ticket()], subscriptions: null },
      NOW,
    );

    expect(composeAttentionChips(summary).map((chip) => chip.id)).toEqual(["replies"]);
  });

  it("produces no overdue chip when nothing is late", () => {
    const summary = composeClientPortalSummary(
      {
        projects: null,
        assignments: null,
        invoices: [invoiceSummary({ state: "unpaid", overdue: false })],
        tickets: null,
        subscriptions: null,
      },
      NOW,
    );

    expect(composeAttentionChips(summary).find((chip) => chip.id === "overdue")).toBeUndefined();
  });
});

describe("active work progress", () => {
  it("uses the real ratio when delivery tasks exist", () => {
    const summary = composeClientPortalSummary(
      { projects: [project()], assignments: null, invoices: null, tickets: null, subscriptions: null },
      NOW,
    );

    expect(activeProjectProgressState(summary.activeProjects[0]!)).toEqual({
      kind: "measured",
      percent: 25,
      label: "1 of 4 steps complete",
    });
  });

  it("states the project's status instead of inventing a percentage", () => {
    const summary = composeClientPortalSummary(
      {
        projects: [project({ progress: { total: 0, completed: 0, percent: null } })],
        assignments: null,
        invoices: null,
        tickets: null,
        subscriptions: null,
      },
      NOW,
    );

    const state = activeProjectProgressState(summary.activeProjects[0]!);
    expect(state.kind).toBe("stated");
    expect(state.label).toBe("Wolf Forge working");
  });
});

describe("dashboard rendering", () => {
  it("renders the featured action once and every other action once", () => {
    renderDashboard(fullBoard());

    const queue = screen.getByRole("heading", { name: "Needs your attention" }).closest("section")!;
    const items = within(queue).getAllByRole("listitem");

    // Four real actions, four cards. No duplicate responsive copy of the queue.
    expect(items).toHaveLength(4);
    expect(within(queue).getAllByRole("link")).toHaveLength(4);
  });

  it("keeps every action's real route", () => {
    renderDashboard(fullBoard());

    const queue = screen.getByRole("heading", { name: "Needs your attention" }).closest("section")!;
    const routes = within(queue)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(routes).toEqual([
      "/account/invoices",
      "/account/projects",
      "/account/messages",
      "/account/onboarding",
    ]);
  });

  it("shows the real attention count in the hero and links it to the queue", () => {
    const summary = fullBoard();
    renderDashboard(summary);

    const counter = screen.getByRole("link", { name: /actions/iu });
    expect(counter).toHaveAttribute("href", "#portal-attention");
    expect(counter).toHaveTextContent(String(summary.attention.length));
  });

  it("hides the counter entirely when nothing is waiting", () => {
    const summary = composeClientPortalSummary(
      { projects: [project()], assignments: null, invoices: null, tickets: null, subscriptions: null },
      NOW,
    );

    renderDashboard(summary);

    expect(screen.queryByRole("link", { name: /actions?$/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Needs your attention" })).not.toBeInTheDocument();
  });

  it("marks only the overdue invoice as urgent", () => {
    const { container } = renderDashboard(fullBoard());

    const urgent = container.querySelectorAll("[data-urgent]");
    expect(urgent).toHaveLength(1);
    expect(urgent[0]).toHaveTextContent("Overdue");
    expect(urgent[0]).toHaveAttribute("href", "/account/invoices");
  });

  it("applies no urgent treatment when the invoice is merely unpaid", () => {
    const { container } = renderDashboard(
      composeClientPortalSummary(
        {
          projects: null,
          assignments: null,
          invoices: [invoiceSummary({ state: "unpaid", overdue: false })],
          tickets: null,
          subscriptions: null,
        },
        NOW,
      ),
    );

    expect(container.querySelectorAll("[data-urgent]")).toHaveLength(0);
  });

  it("still renders real active work with its project data", () => {
    renderDashboard(fullBoard());

    const work = screen.getByRole("heading", { name: "Active work" }).closest("section")!;

    expect(within(work).getByText("WF-P0001")).toBeInTheDocument();
    expect(within(work).getAllByText("Google Business Profile optimisation").length).toBeGreaterThan(0);
    expect(within(work).getAllByText("Local SEO").length).toBeGreaterThan(0);
    // Both fixtures sit at the same real ratio, so the rail label repeats.
    expect(within(work).getAllByRole("img", { name: "1 of 4 steps complete" })).toHaveLength(2);
  });

  it("keeps the brand-new welcome state untouched", () => {
    renderDashboard(
      composeClientPortalSummary(
        { projects: [], assignments: [], invoices: [], tickets: [], subscriptions: [] },
        NOW,
      ),
    );

    expect(screen.getByRole("heading", { name: "Welcome, Sarah" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Needs your attention" })).not.toBeInTheDocument();
  });
});

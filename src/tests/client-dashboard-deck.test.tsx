/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientDashboard } from "../components/account/dashboard/client-dashboard";
import { resolveWalletFunding } from "../domain/client-portal/payment-method";
import { composeClientPortalSummary } from "../domain/client-portal/summary";
import { composeClientPaymentRails } from "../domain/payments/payment-rails";
import type { FormAssignmentSummary } from "../domain/forms/schema";
import type { ClientProjectView } from "../domain/orders/client-projections";
import type { SubscriptionSummary } from "../domain/subscriptions/schema";
import type { ClientTicketSummary } from "../domain/tickets/schema";
import type { ClientInvoiceSummary } from "../repositories/invoice-repository";

/**
 * The client deck: Active Work, Billing and Recent Conversations.
 *
 * The refinement was presentation only, so these assertions are about the data
 * surviving the redesign — real project state, real balances, real conversation
 * metadata, real routes — and about the new hover affordances remaining
 * reachable without a pointer.
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
    status: "completed",
    required: true,
    due_at: null,
    assigned_at: "2026-08-10T00:00:00.000Z",
    completed_at: "2026-08-12T00:00:00.000Z",
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
    dueLabel: "Due 30 Aug 2026",
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
      presentation_state: overrides.state ?? "unpaid",
      balance_due_cents: overrides.balance ?? 323_000,
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

function deckSummary(overrides: Partial<Parameters<typeof composeClientPortalSummary>[0]> = {}) {
  return composeClientPortalSummary(
    {
      projects: [project(), project({ id: "project-2", reference: "WF-P0002", title: "Press releases" })],
      assignments: [assignment()],
      invoices: [invoiceSummary()],
      tickets: [ticket()],
      subscriptions: [subscription()],
      ...overrides,
    },
    NOW,
  );
}

/**
 * The shipped rail configuration: a real Wolf Forge Balance, and two external
 * rails Wolf Forge has not connected. Built through the domain rather than
 * hand-written, so a change to how a rail is composed reaches these assertions.
 */
const deckRails = composeClientPaymentRails({
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
      paymentRails={deckRails}
      storeGranted={true}
    />,
  );
}

function sectionFor(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section")!;
}

describe("active work rail", () => {
  it("renders every real project with its code, name and service", () => {
    renderDashboard(deckSummary());
    const work = sectionFor("Active work");

    expect(within(work).getByText("WF-P0001")).toBeInTheDocument();
    expect(within(work).getByText("Google Business Profile optimisation")).toBeInTheDocument();
    expect(within(work).getByText("WF-P0002")).toBeInTheDocument();
    expect(within(work).getAllByText("Local SEO")).toHaveLength(2);
  });

  it("leads with the project name and follows it with the identifier", () => {
    renderDashboard(deckSummary());

    const title = within(sectionFor("Active work")).getByText(
      "Google Business Profile optimisation",
    );
    const heading = title.parentElement!;
    const reference = within(heading as HTMLElement).getByText("WF-P0001");

    // Both live on the same line, and the name comes first in reading order.
    expect(heading).toContainElement(reference);
    expect(
      title.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the identifier visible rather than hiding it behind the name", () => {
    renderDashboard(deckSummary());
    const work = sectionFor("Active work");

    for (const reference of ["WF-P0001", "WF-P0002"]) {
      expect(within(work).getByText(reference)).toBeVisible();
    }
  });

  it("shows the real delivery state and due context", () => {
    renderDashboard(deckSummary());
    const work = sectionFor("Active work");

    expect(within(work).getAllByText("Wolf Forge working")).toHaveLength(2);
    expect(within(work).getAllByText("Due 30 Aug 2026")).toHaveLength(2);
  });

  it("draws a rail only from a real completed/total ratio", () => {
    renderDashboard(deckSummary());
    const work = sectionFor("Active work");

    expect(within(work).getAllByRole("img", { name: "1 of 4 steps complete" })).toHaveLength(2);
  });

  it("states the absence of progress rather than drawing an empty rail", () => {
    renderDashboard(
      deckSummary({
        projects: [project({ progress: { total: 0, completed: 0, percent: null } })],
      }),
    );

    const work = sectionFor("Active work");
    expect(within(work).getByText("Progress not tracked yet")).toBeInTheDocument();
    expect(within(work).queryByRole("img")).not.toBeInTheDocument();
    // No percentage anywhere in the section when none is measurable.
    expect(work.textContent).not.toMatch(/\d+%/u);
  });

  it("links each project to its own route, exactly once", () => {
    renderDashboard(deckSummary());
    const work = sectionFor("Active work");

    const routes = within(work)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(routes).toEqual([
      "/account/projects",
      "/account/projects/project-1",
      "/account/projects/project-2",
    ]);
  });
});

describe("billing strip", () => {
  it("renders the real outstanding balance and its supporting counts", () => {
    renderDashboard(deckSummary());
    const billing = sectionFor("Billing");

    expect(within(billing).getByText("$3,230.00")).toBeInTheDocument();
    expect(within(billing).getByText("Outstanding balance")).toBeInTheDocument();
    // Stacked from the same parts the Invoices page joins into one line.
    expect(within(billing).getByText("1 unpaid invoice")).toBeInTheDocument();
  });

  it("marks the overdue count, and only when something is genuinely overdue", () => {
    const { container, unmount } = renderDashboard(
      deckSummary({ invoices: [invoiceSummary({ state: "overdue", overdue: true })] }),
    );

    const overdue = container.querySelectorAll(`[data-overdue]`);
    expect(overdue.length).toBeGreaterThan(0);
    expect(within(sectionFor("Billing")).getByText("1 overdue")).toBeInTheDocument();
    unmount();

    // Unpaid but not late: no urgency marker anywhere in the strip.
    renderDashboard(deckSummary());
    expect(sectionFor("Billing").querySelectorAll(`[data-overdue]`)).toHaveLength(0);
  });

  it("shows each currency separately and never a combined total", () => {
    renderDashboard(
      deckSummary({ invoices: [invoiceSummary(), invoiceSummary({ currency: "GBP" })] }),
    );

    const billing = sectionFor("Billing");
    expect(within(billing).getByText("$3,230.00")).toBeInTheDocument();
    expect(within(billing).getByText("£3,230.00")).toBeInTheDocument();
    expect(within(billing).getByText("USD")).toBeInTheDocument();
    expect(within(billing).getByText("GBP")).toBeInTheDocument();
    // A summed figure would be $6,460.00 and must never appear.
    expect(billing.textContent).not.toContain("6,460");
  });

  it("renders the real next billing date and its service", () => {
    renderDashboard(deckSummary());
    const billing = sectionFor("Billing");

    expect(within(billing).getByText("Sep 18, 2026")).toBeInTheDocument();
    expect(within(billing).getByText(/Local SEO retainer/u)).toBeInTheDocument();
  });

  it("states the real reason when no billing date is scheduled", () => {
    renderDashboard(
      deckSummary({ subscriptions: [subscription({ next_payment_on: null })] }),
    );

    expect(within(sectionFor("Billing")).getByText("No billing date is scheduled yet.")).toBeInTheDocument();
  });

  it("names the real default payment rail instead of claiming there is none", () => {
    renderDashboard(deckSummary());
    const billing = sectionFor("Billing");

    expect(within(billing).getByText("Wolf Forge Balance")).toBeInTheDocument();
    expect(within(billing).getByText("$500.00 available")).toBeInTheDocument();
    expect(within(billing).getByText("Default payment method")).toBeInTheDocument();

    // The untruth this replaced.
    expect(billing.textContent).not.toContain("No payment method on file");
    // No brand, no last four, no expiry can exist on this surface.
    expect(billing.textContent).not.toMatch(/Visa|Mastercard|••••|\d{2}\/\d{2}/u);
  });

  it("keeps all three billing routes, one per zone", () => {
    renderDashboard(deckSummary());
    const routes = within(sectionFor("Billing"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(routes).toEqual([
      "/account/invoices",
      "/account/subscriptions",
      "/account/payment-method",
    ]);
  });

  it("omits the subscriptions zone when the module is denied", () => {
    renderDashboard(deckSummary({ subscriptions: null }));
    const routes = within(sectionFor("Billing"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(routes).not.toContain("/account/subscriptions");
    expect(routes).toContain("/account/invoices");
  });
});

describe("recent conversations stack", () => {
  it("renders the real conversation data", () => {
    renderDashboard(deckSummary());
    const messages = sectionFor("Recent conversations");

    expect(within(messages).getByText("WF-TKT-000001")).toBeInTheDocument();
    expect(within(messages).getByText("Homepage copy")).toBeInTheDocument();
    expect(within(messages).getByText("3 messages")).toBeInTheDocument();
    expect(within(messages).getByText("Waiting on you")).toBeInTheDocument();
  });

  it("links each conversation to its own thread", () => {
    renderDashboard(deckSummary());
    const routes = within(sectionFor("Recent conversations"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(routes).toEqual(["/account/messages", "/account/messages/ticket-1"]);
  });

  it("shows no unread indicator, because the ticket model has no unread state", () => {
    renderDashboard(deckSummary());
    expect(sectionFor("Recent conversations").textContent).not.toMatch(/unread/iu);
  });

  it("keeps its written empty state", () => {
    renderDashboard(deckSummary({ tickets: [] }));
    expect(
      within(sectionFor("Recent conversations")).getByText(/No conversations yet/u),
    ).toBeInTheDocument();
  });
});

describe("deck composition", () => {
  it("renders each real record once per section, with no duplicated responsive markup", () => {
    renderDashboard(deckSummary());

    /*
     * Scoped per section on purpose. A subject legitimately appears twice on the
     * page — once in its conversation row and once inside the attention card
     * that summarises what is waiting — so a page-wide count would assert the
     * wrong thing. What must never happen is the same record twice inside one
     * section, which is what a hidden mobile copy would produce.
     */
    expect(
      within(sectionFor("Active work")).getAllByText("Google Business Profile optimisation"),
    ).toHaveLength(1);
    expect(within(sectionFor("Recent conversations")).getAllByText("Homepage copy")).toHaveLength(1);
    expect(within(sectionFor("Billing")).getAllByText("$3,230.00")).toHaveLength(1);
  });

  it("keeps every section heading semantic and in order", () => {
    renderDashboard(deckSummary());

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(headings).toEqual([
      "Needs your attention",
      "Active work",
      "Billing",
      "Recent conversations",
    ]);
  });

  it("exposes every deck row as a real link, reachable by keyboard", () => {
    const { container } = renderDashboard(deckSummary());

    // Nothing in the deck relies on a div with a click handler.
    expect(container.querySelectorAll("[onclick]")).toHaveLength(0);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href");
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
  });
});

/**
 * Interaction guarantees that live in CSS.
 *
 * jsdom applies no stylesheet, so these read the module directly. They are the
 * cheapest honest way to hold the two rules that matter: a pointer-only
 * affordance would be inaccessible, and motion must be removable.
 */
describe("deck interaction contracts", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/components/account/dashboard/client-deck.module.css"),
    "utf8",
  );

  it("mirrors every hover enhancement with focus-visible", () => {
    for (const selector of [
      ".project:focus-visible",
      ".zone:focus-visible",
      ".conversation:focus-visible",
    ]) {
      expect(css).toContain(selector);
    }

    expect(css).toContain(".project:focus-visible .projectArrow");
    expect(css).toContain(".conversation:focus-visible .conversationOpen");
    expect(css).toContain(".zone:focus-visible .zoneAction svg");
  });

  it("supports a reduced-motion path that removes animation and movement", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");

    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
    expect(reduced).toContain("transform: none");
  });

  it("keeps feature variables on a local class rather than :root", () => {
    expect(css).not.toMatch(/^\s*:root\s*\{/mu);
    expect(css).not.toMatch(/^\s*(html|body)\s*[,{]/mu);
    expect(css).toMatch(/\.section\s*\{[^}]*--wf-deck-stagger/u);
  });
});

/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const createInternalTicketAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock("../app/actions/store-interest", () => ({
  updateInvestmentIntentStatusAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../app/actions/tickets", () => ({
  createInternalTicketAction: (...args: unknown[]) => createInternalTicketAction(...args),
}));

const { InvestmentIntentWorkspace } = await import(
  "../components/investment-intent/investment-intent-workspace"
);
const { toInvestmentIntentViews } = await import("../domain/store-interest/projections");
const { createTicketSchema } = await import("../domain/tickets/schema");

import type { InvestmentIntentRow } from "../domain/store-interest/schema";

const COMPANY_ID = "30000000-0000-4000-8000-0000000000aa";
const SERVICE_ID = "40000000-0000-4000-8000-0000000000bb";
const TICKET_ID = "50000000-0000-4000-8000-0000000000cc";

function row(overrides: Partial<InvestmentIntentRow> = {}): InvestmentIntentRow {
  return {
    intent_id: "intent-1",
    company_id: COMPANY_ID,
    company_name: "Ironclad Dental",
    service_id: SERVICE_ID,
    service_name: "MAPS SPRINT",
    folder_name: "Local SEO",
    price: 97,
    currency: "USD",
    recurring: false,
    recurring_price: null,
    recurring_interval_length: null,
    recurring_interval_unit: null,
    status: "new",
    in_cart: true,
    add_count: 1,
    first_added_at: "2026-09-01T10:00:00.000Z",
    last_added_at: "2026-09-01T10:00:00.000Z",
    removed_at: null,
    last_activity_at: "2026-09-02T10:00:00.000Z",
    contacted_at: null,
    contacted_by_profile_id: null,
    contacted_by_name: null,
    updated_at: "2026-09-02T10:00:00.000Z",
    active_ticket_id: null,
    active_ticket_status: null,
    ...overrides,
  };
}

function views(overrides: Partial<InvestmentIntentRow> = {}) {
  return toInvestmentIntentViews([row(overrides)]);
}

function trigger() {
  /* The workspace renders a desktop table and a mobile card list; the first
     trigger is the table's, and both are asserted separately below. */
  return screen.getAllByRole("button", { name: /^Actions for Ironclad Dental and MAPS SPRINT$/ })[0]!;
}

function openMenu() {
  fireEvent.click(trigger());
  return screen.getByRole("menu", { name: "Actions for Ironclad Dental and MAPS SPRINT" });
}

function openDraft() {
  const menu = openMenu();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Create investment conversation" }));
  return screen.getByRole("dialog", { name: "Create investment conversation" });
}

beforeEach(() => {
  refresh.mockReset();
  createInternalTicketAction.mockReset();
  createInternalTicketAction.mockResolvedValue({ ok: true, ticketId: TICKET_ID });

  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("investment intent row actions", () => {
  it("renders its actions behind one compact + trigger per row", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);

    /* Two triggers, because the workspace renders the desktop table and the
       mobile card list at the same time; one per view, never two per row. */
    expect(
      screen.getAllByRole("button", { name: "Actions for Ironclad Dental and MAPS SPRINT" }),
    ).toHaveLength(2);

    /* The links the menu replaces are gone from the row itself. */
    expect(screen.queryByRole("link", { name: "Open client" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open investment" })).toBeNull();
  });

  it("keeps Open client inside the menu, on its original destination", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const menu = openMenu();

    expect(within(menu).getByRole("menuitem", { name: "Open client" })).toHaveAttribute(
      "href",
      `/clients/${COMPANY_ID}`,
    );
  });

  it("keeps Open investment inside the menu, on its original destination", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const menu = openMenu();

    expect(within(menu).getByRole("menuitem", { name: "Open investment" })).toHaveAttribute(
      "href",
      `/services/${SERVICE_ID}`,
    );
  });

  it("offers to create a conversation when none is live", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const menu = openMenu();

    expect(
      within(menu).getByRole("menuitem", { name: "Create investment conversation" }),
    ).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Open investment conversation" })).toBeNull();
  });

  it("offers to open the live conversation when one exists", () => {
    render(
      <InvestmentIntentWorkspace
        intents={views({ active_ticket_id: TICKET_ID, active_ticket_status: "open" })}
        canManage
      />,
    );
    const menu = openMenu();

    expect(
      within(menu).getByRole("menuitem", { name: "Open investment conversation" }),
    ).toHaveAttribute("href", `/tickets/${TICKET_ID}`);
    expect(
      within(menu).queryByRole("menuitem", { name: "Create investment conversation" }),
    ).toBeNull();
  });
});

describe("investment conversation draft", () => {
  it("shows the client and investment it will be about", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    expect(within(dialog).getByText("Ironclad Dental")).toBeTruthy();
    expect(within(dialog).getByText("MAPS SPRINT")).toBeTruthy();
    expect(within(dialog).getByText("Local SEO · $97 · One-time")).toBeTruthy();
  });

  it("prefills a subject naming the investment", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    expect(within(dialog).getByLabelText("Subject")).toHaveValue("Interested in MAPS SPRINT");
  });

  it("prefills a message that never mentions carts, analytics or internal status", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();
    const message = (within(dialog).getByLabelText("Message") as HTMLTextAreaElement).value;

    expect(message).toContain("Hi there,");
    expect(message).toContain("We noticed you're interested in MAPS SPRINT.");

    /*
     * The client is told their interest was noticed. They are never told they
     * were watched, scored, or tracked.
     */
    for (const forbidden of [
      "cart",
      "analytic",
      "tracking",
      "tracked",
      "CRM",
      "we saw you",
      "Investment Intent",
      "status",
    ]) {
      expect(message.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("leaves the subject and message editable", () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    fireEvent.change(within(dialog).getByLabelText("Subject"), {
      target: { value: "A hand-written subject" },
    });
    fireEvent.change(within(dialog).getByLabelText("Message"), {
      target: { value: "A hand-written message." },
    });

    expect(within(dialog).getByLabelText("Subject")).toHaveValue("A hand-written subject");
    expect(within(dialog).getByLabelText("Message")).toHaveValue("A hand-written message.");
  });

  it("submits the edited draft with the company and investment, and nothing about an order", async () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    fireEvent.change(within(dialog).getByLabelText("Subject"), {
      target: { value: "A hand-written subject" },
    });
    fireEvent.change(within(dialog).getByLabelText("Message"), {
      target: { value: "A hand-written message." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create conversation" }));

    await waitFor(() => expect(createInternalTicketAction).toHaveBeenCalledTimes(1));

    const payload = createInternalTicketAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.companyId).toBe(COMPANY_ID);
    expect(payload.investmentServiceId).toBe(SERVICE_ID);
    expect(payload.subject).toBe("A hand-written subject");
    expect(payload.message).toBe("A hand-written message.");
    expect(payload.priority).toBe("normal");
    expect(typeof payload.requestId).toBe("string");

    /* An investment conversation is a plain Ticket. Nothing here may link it to
       an Order, a Project, or a Project conversation. */
    for (const key of Object.keys(payload)) {
      expect(key.toLowerCase()).not.toContain("order");
      expect(key.toLowerCase()).not.toContain("project");
    }
  });

  it("turns the row into Open investment conversation after creation, on authoritative data", async () => {
    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create conversation" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Create investment conversation" })).toBeNull();

    /* The override is immediate, and the server revalidation is what makes it
       stick -- neither is asked to carry the state alone. */
    const menu = openMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Open investment conversation" }),
    ).toHaveAttribute("href", `/tickets/${TICKET_ID}`);
  });

  it("reloads and says so when the conversation already exists, instead of printing a constraint", async () => {
    createInternalTicketAction.mockResolvedValue({
      ok: false,
      conflict: true,
      error: "This client already has an investment conversation for this investment. Reloading the latest state.",
    });

    render(<InvestmentIntentWorkspace intents={views()} canManage />);
    const dialog = openDraft();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create conversation" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(within(dialog).getByRole("alert").textContent).toContain("already has an investment conversation");
  });
});

describe("ordinary ticket creation is untouched", () => {
  it("accepts a payload with no investment_service_id and invents none", () => {
    const parsed = createTicketSchema.parse({
      request_id: "60000000-0000-4000-8000-0000000000dd",
      company_id: COMPANY_ID,
      subject: "Ordinary question",
      message: "Nothing to do with investments.",
      priority: "normal",
    });

    expect("investment_service_id" in parsed).toBe(false);
  });

  it("still accepts investment_service_id when a caller supplies one", () => {
    const parsed = createTicketSchema.parse({
      request_id: "60000000-0000-4000-8000-0000000000de",
      company_id: COMPANY_ID,
      investment_service_id: SERVICE_ID,
      subject: "Interested in MAPS SPRINT",
      message: "Hi there,",
    });

    expect(parsed.investment_service_id).toBe(SERVICE_ID);
  });
});

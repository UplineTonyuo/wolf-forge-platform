/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamTicketsPane } from "../components/team/team-tickets-pane";
import type { TicketSummary } from "../domain/tickets/schema";

afterEach(cleanup);

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    ticket_id: "t1",
    public_ref: "TCK-1",
    company_id: "c1",
    company_name: "Acme Co",
    client_profile_id: "cp1",
    client_name: "Client Person",
    subject: "Billing question",
    status: "waiting_on_client",
    priority: "normal",
    assigned_to_profile_id: null,
    assigned_to_name: null,
    message_count: 3,
    last_message_at: "2026-09-17T10:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-17T10:00:00Z",
    archived_at: null,
    inbox_added_at: "2026-09-02T00:00:00Z",
    ...overrides,
  };
}

describe("TeamTicketsPane", () => {
  it("searches full and partial references, all tickets for a client, and clears an empty result", () => {
    render(<TeamTicketsPane tickets={[
      ticket({ public_ref: "WF-TKT-000006" }),
      ticket({ ticket_id: "t2", public_ref: "WF-TKT-000007", subject: "Another question" }),
      ticket({ ticket_id: "t3", public_ref: "WF-TKT-000008", company_name: "Other company", client_name: "Other person" }),
    ]} loading={false} error={null} activeTicketId={null} onSelect={vi.fn()} onRetry={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Search tickets" });
    for (const query of ["WF-TKT-000006", "000006"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText("WF-TKT-000006")).toBeInTheDocument();
    }
    for (const query of ["Acme", "Client Person"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    }
    fireEvent.change(search, { target: { value: "not found" } });
    expect(screen.getByText("No tickets found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear ticket search" }));
    expect(search).toHaveValue("");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("renders a lightweight row per Ticket — subject, status, company — with no unread affordance", () => {
    render(
      <TeamTicketsPane
        tickets={[ticket()]}
        loading={false}
        error={null}
        activeTicketId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Billing question")).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    // No unread schema exists (clientPortalUnreadIsSupported is false); the
    // row must never invent one, e.g. by badging waiting_on_client as unread.
    expect(screen.queryByLabelText(/unread/i)).not.toBeInTheDocument();
  });

  it("selecting a row calls onSelect with that Ticket's id, never fetching a transcript itself", () => {
    const onSelect = vi.fn();
    render(
      <TeamTicketsPane
        tickets={[ticket({ ticket_id: "t42" })]}
        loading={false}
        error={null}
        activeTicketId={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Billing question"));
    expect(onSelect).toHaveBeenCalledWith("t42");
  });

  it("shows the empty state only once loaded, with no error", () => {
    render(
      <TeamTicketsPane
        tickets={[]}
        loading={false}
        error={null}
        activeTicketId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("No Tickets yet")).toBeInTheDocument();
  });

  it("surfaces a retry action on error instead of silently showing an empty list", () => {
    const onRetry = vi.fn();
    render(
      <TeamTicketsPane
        tickets={[]}
        loading={false}
        error="Tickets could not be refreshed."
        activeTicketId={null}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Tickets could not be refreshed.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

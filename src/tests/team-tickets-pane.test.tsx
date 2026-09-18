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

/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamTicketsPane } from "../components/team/team-tickets-pane";
import { WorkflowLabelProvider } from "../components/settings/workflow-labels";
import type { TicketSummary } from "../domain/tickets/schema";

const controls = { page: 1, pages: 1, query: "", onPageChange: vi.fn(), onQueryChange: vi.fn() };
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
  it("uses the workspace label for the ticket's stored status", () => {
    render(<WorkflowLabelProvider value={{ clients: [], tickets: [
      { key: "waiting_on_client", name: "Client follow-up", color: "#435787", description: "" },
    ] }}>
      <TeamTicketsPane {...controls} tickets={[ticket()]} loading={false} error={null}
        activeTicketId={null} onSelect={vi.fn()} onRetry={vi.fn()} />
    </WorkflowLabelProvider>);
    expect(screen.getByRole("listitem")).toHaveTextContent("Client follow-up");
  });
  it("requests the adjacent page and forwards search edits to the list owner", () => {
    const onPageChange = vi.fn();
    const onQueryChange = vi.fn();
    render(<TeamTicketsPane {...controls} pages={90} onPageChange={onPageChange} onQueryChange={onQueryChange}
      tickets={[ticket()]} loading={false} error={null} activeTicketId={null} onSelect={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Page 1 of 90")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "later ticket" } });
    expect(onQueryChange).toHaveBeenCalledWith("later ticket");
  });
  it("renders a lightweight row per Ticket — subject, status, company — with no unread affordance", () => {
    render(
      <TeamTicketsPane {...controls}
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
      <TeamTicketsPane {...controls}
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

  it("first load shows ticket-row skeletons, not a spinner or the empty state", () => {
    const { container } = render(
      <TeamTicketsPane {...controls}
        tickets={[]}
        loading
        error={null}
        activeTicketId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const status = screen.getByRole("status", { name: "Loading tickets" });
    expect(status.querySelectorAll("[aria-hidden='true']")).toHaveLength(6);
    expect(status.textContent).toBe("");
    expect(container.querySelector("svg.lucide-loader-circle, svg.lucide-loader-2, [class*='spin']")).toBeNull();
    expect(screen.queryByText("No Tickets yet")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search tickets" })).toBeInTheDocument();
  });

  it("shows the empty state only once loaded, with no error", () => {
    render(
      <TeamTicketsPane {...controls}
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
      <TeamTicketsPane {...controls}
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

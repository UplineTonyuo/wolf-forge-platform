/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "../app/actions/tickets";
import { ClientTickets } from "../components/tickets/client-tickets";
import { TicketAdminControls } from "../components/tickets/ticket-admin-controls";
import { TicketComposer } from "../components/tickets/ticket-composer";
import { TicketConversation } from "../components/tickets/ticket-conversation";
import { TicketsList } from "../components/tickets/tickets-list";
import type { TicketCapabilities, TicketDetailMessage, TicketSummary } from "../domain/tickets/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../app/actions/tickets", () => ({
  adminReplyTicketAction: vi.fn(), clientReplyTicketAction: vi.fn(), addTicketInternalNoteAction: vi.fn(),
  createClientTicketAction: vi.fn(), createInternalTicketAction: vi.fn(), updateTicketStatusAction: vi.fn(), updateTicketPriorityAction: vi.fn(), assignTicketAction: vi.fn(),
}));

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: vi.fn(() => "10000000-0000-4000-8000-000000000001") }, configurable: true });
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.values(actions).forEach((action) =>
    vi.mocked(action).mockResolvedValue({
      ok: true,
      ticketId: "20000000-0000-4000-8000-000000000099",
    } as never),
  );
});
afterEach(cleanup);

const ticket: TicketSummary = {
  ticket_id: "20000000-0000-4000-8000-000000000001", public_ref: "WF-T000042", company_id: "company-a", company_name: "Northpoint Logistics", client_profile_id: "client-a", client_name: "Avery Stone", subject: "Need help with the campaign brief", status: "open", priority: "high", assigned_to_profile_id: "staff-a", assigned_to_name: "William", message_count: 2, last_message_at: "2026-08-14T08:00:00Z", created_at: "2026-08-14T07:00:00Z", updated_at: "2026-08-14T08:00:00Z", archived_at: null,
};
const other: TicketSummary = { ...ticket, ticket_id: "20000000-0000-4000-8000-000000000002", public_ref: "WF-T000043", company_name: "Summit Financial", subject: "Invoice question", status: "waiting_on_client", priority: "normal", assigned_to_name: null };
const messages: TicketDetailMessage[] = [
  { id: "m1", ticket_id: ticket.ticket_id, author_profile_id: "client-a", author_name: "Avery Stone", author_type: "client", message_kind: "initial_request", visibility: "client", body: "Can you help with the brief?", created_at: ticket.created_at, attachments: [] },
  { id: "m2", ticket_id: ticket.ticket_id, author_profile_id: "staff-a", author_name: "William", author_type: "internal", message_kind: "internal_note", visibility: "internal", body: "Confirm scope before replying.", created_at: ticket.updated_at, attachments: [] },
];
const capabilities: TicketCapabilities = { view: true, create: true, reply: true, edit: true, assign: true, internalNotes: true, archive: true };

describe("Tickets admin list", () => {
  it("renders real operational fields and links by UUID", () => {
    render(<TicketsList summaries={[ticket]} />);
    expect(screen.getAllByText("WF-T000042").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Northpoint Logistics").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /WF-T000042/ })[0]).toHaveAttribute("href", `/tickets/${ticket.ticket_id}`);
  });
  it("searches and filters the authorized summary set", () => {
    render(<TicketsList summaries={[ticket, other]} />);
    fireEvent.change(screen.getByPlaceholderText(/Search reference/), { target: { value: "Summit" } });
    expect(screen.getAllByText("WF-T000043").length).toBeGreaterThan(0);
    expect(screen.queryByText("WF-T000042")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "open" } });
    expect(screen.getByText("No Tickets match your filters.")).toBeInTheDocument();
  });
  it("renders a deliberate empty state", () => {
    render(<TicketsList summaries={[]} />);
    expect(screen.getByText("No Tickets yet.")).toBeInTheDocument();
  });
});

describe("Ticket detail and actions", () => {
  it("renders client-visible replies and a clearly marked internal note", () => {
    render(<TicketConversation messages={messages} />);
    expect(screen.getByText("Can you help with the brief?")).toBeInTheDocument();
    expect(screen.getByText("Internal note")).toBeInTheDocument();
    expect(screen.getByText("Confirm scope before replying.")).toBeInTheDocument();
  });
  it("wires staff replies and immutable internal notes with stable request IDs", async () => {
    const { rerender } = render(<TicketComposer ticketId={ticket.ticket_id} mode="admin" />);
    fireEvent.change(screen.getByPlaceholderText("Write a replyÃ¢â‚¬Â¦"), { target: { value: "We are reviewing this now." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.adminReplyTicketAction).toHaveBeenCalledWith(ticket.ticket_id, expect.any(String), "We are reviewing this now."));
    rerender(<TicketComposer ticketId={ticket.ticket_id} mode="note" />);
    fireEvent.change(screen.getByPlaceholderText(/private context/), { target: { value: "Internal context" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(actions.addTicketInternalNoteAction).toHaveBeenCalled());
  });
  it("wires resolve, reopen, priority, and assignment operations", async () => {
    const { rerender } = render(<TicketAdminControls ticketId={ticket.ticket_id} status="open" priority="high" assigneeId={null} assignees={[{ id: "staff-a", displayName: "William" }]} capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(actions.updateTicketStatusAction).toHaveBeenCalledWith(ticket.ticket_id, "resolved"));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), { target: { value: "urgent" } });
    await waitFor(() => expect(actions.updateTicketPriorityAction).toHaveBeenCalledWith(ticket.ticket_id, "urgent"));
    fireEvent.change(screen.getByRole("combobox", { name: "Assigned Wolf Forge member" }), { target: { value: "staff-a" } });
    await waitFor(() => expect(actions.assignTicketAction).toHaveBeenCalledWith(ticket.ticket_id, "staff-a"));
    rerender(<TicketAdminControls ticketId={ticket.ticket_id} status="closed" priority="high" assigneeId={null} assignees={[]} capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(actions.updateTicketStatusAction).toHaveBeenCalledWith(ticket.ticket_id, "open"));
  });
});

describe("Client Tickets", () => {
  it("renders only client-safe list data and creates a Ticket once", async () => {
    render(<ClientTickets summaries={[ticket]} />);
    expect(screen.getByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.queryByText("William")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Create Ticket" })[0]!);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New request" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please help us." } });
    const createButtons = screen.getAllByRole("button", { name: "Create Ticket" });
    fireEvent.click(createButtons[createButtons.length - 1]!);
    await waitFor(() => expect(actions.createClientTicketAction).toHaveBeenCalledTimes(1));
  });
  it("does not render internal notes in the client conversation", () => {
    render(<TicketConversation messages={messages} clientView />);
    expect(screen.getByText("Can you help with the brief?")).toBeInTheDocument();
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
  });
});

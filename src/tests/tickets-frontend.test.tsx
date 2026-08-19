/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "../app/actions/tickets";
import { ClientMessages } from "../components/account/messages/client-messages";
import { TicketAdminControls } from "../components/tickets/ticket-admin-controls";
import { TicketComposer } from "../components/tickets/ticket-composer";
import { TicketConversation } from "../components/tickets/ticket-conversation";
import { TicketsList } from "../components/tickets/tickets-list";
import type { TicketCapabilities, TicketDetailMessage, TicketSummary } from "../domain/tickets/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
/*
 * ClientMessages seeds its composer from the cart, and the cart store reports
 * cart changes to the server as investment intent. Mocking that action keeps the
 * server-only module out of this jsdom graph, exactly as the ticket actions
 * below are mocked for the same reason.
 */
vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: vi.fn(async () => ({ ok: true })),
}));
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
  { id: "m1", ticket_id: ticket.ticket_id, author_profile_id: "client-a", author_name: "Avery Stone", author_avatar_url: null, author_type: "client", message_kind: "initial_request", visibility: "client", body: "Can you help with the brief?", created_at: ticket.created_at, attachments: [] },
  { id: "m2", ticket_id: ticket.ticket_id, author_profile_id: "staff-a", author_name: "William", author_avatar_url: null, author_type: "internal", message_kind: "internal_note", visibility: "internal", body: "Confirm scope before replying.", created_at: ticket.updated_at, attachments: [] },
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
    fireEvent.click(
      screen.getByRole("button", {
        name: "All statuses",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open",
      }),
    );
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
    const replyEditor = screen.getByRole("textbox", { name: "Write a reply" });
    replyEditor.innerHTML = "We are reviewing this now.";
    fireEvent.input(replyEditor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.adminReplyTicketAction).toHaveBeenCalledWith(ticket.ticket_id, expect.any(String), "We are reviewing this now."));
    rerender(<TicketComposer ticketId={ticket.ticket_id} mode="note" />);
    fireEvent.change(screen.getByPlaceholderText(/private message to your team/i), { target: { value: "Internal context" } });
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

describe("Client Messages", () => {
  it("renders only client-safe list data and starts a conversation once", async () => {
    render(<ClientMessages summaries={[ticket]} />);
    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    /* Assignee identity is not part of the client projection at all. */
    expect(screen.queryByText("William")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New request" } });
    // The composer now uses the same rich text editor as the reply composer.
    const editor = screen.getByRole("textbox", { name: "Write a message" });
    editor.innerHTML = "Please help us.";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(actions.createClientTicketAction).toHaveBeenCalledTimes(1));
  });

  it("links a conversation to the Messages route and shows a real attention state", () => {
    render(<ClientMessages summaries={[{ ...ticket, status: "waiting_on_client" }]} />);

    expect(screen.getByRole("link", { name: new RegExp(ticket.subject) })).toHaveAttribute(
      "href",
      `/account/messages/${ticket.ticket_id}`,
    );
    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
  });

  it("shows no unread indicator, because the model cannot back one", () => {
    const { container } = render(<ClientMessages summaries={[ticket]} />);

    expect(container.querySelector("[data-unread]")).toBeNull();
    expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
  });

  it("opens the composer as a centered modal dialog, not a corner-pinned element", () => {
    render(<ClientMessages summaries={[ticket]} />);
    fireEvent.click(screen.getByRole("button", { name: "New message" }));

    const dialog = screen.getByRole("dialog");

    /*
     * The overlay owns its own centering. The old implementation relied on the
     * native <dialog> element's `margin: auto`, which Tailwind's preflight
     * resets to 0 — that is what pinned it to the top-left corner.
     */
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.closest(".portal-overlay")).not.toBeNull();
    expect(dialog.tagName).not.toBe("DIALOG");
    expect(screen.getByRole("heading", { name: "New message" })).toBeInTheDocument();
  });

  it("closes the composer on Escape without submitting", async () => {
    render(<ClientMessages summaries={[ticket]} />);
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.createClientTicketAction).not.toHaveBeenCalled();
  });

  it("keeps submission disabled until both fields are filled", () => {
    render(<ClientMessages summaries={[ticket]} />);
    fireEvent.click(screen.getByRole("button", { name: "New message" }));

    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Only a subject" } });
    expect(send).toBeDisabled();

    const editor = screen.getByRole("textbox", { name: "Write a message" });
    editor.innerHTML = "And a body.";
    fireEvent.input(editor);
    expect(send).toBeEnabled();
  });

  it("opens the composer when the command bar asks for it", async () => {
    render(<ClientMessages summaries={[ticket]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The quick action broadcasts rather than mounting a second composer, so
    // there is one validation path and one submit action in the product.
    fireEvent(window, new CustomEvent("wf:client-new-message"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the composer immediately when routed in with compose=1", () => {
    render(<ClientMessages summaries={[ticket]} composeOnMount />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("does not render internal notes in the client conversation", () => {
    render(<TicketConversation messages={messages} clientView />);
    expect(screen.getByText("Can you help with the brief?")).toBeInTheDocument();
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
  });
});

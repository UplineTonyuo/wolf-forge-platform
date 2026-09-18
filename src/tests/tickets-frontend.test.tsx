/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "../app/actions/tickets";
import { ClientMessages } from "../components/account/messages/client-messages";
import { InternalNotesModal } from "../components/tickets/internal-notes-modal";
import { OrderConversation } from "../components/tickets/order-conversation";
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
  sendTicketComposerAction: vi.fn(),
  adminReplyTicketAction: vi.fn(), clientReplyTicketAction: vi.fn(), addTicketInternalNoteAction: vi.fn(),
  adminSendOrderMessageAction: vi.fn(), clientSendOrderMessageAction: vi.fn(),
  adminReplyToTicketMessageAction: vi.fn(), clientReplyToTicketMessageAction: vi.fn(),
  toggleTicketMessageReactionAction: vi.fn(), forwardTicketMessageToTeamAction: vi.fn(),
  unsendTicketInternalNoteAction: vi.fn(),
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
  ticket_id: "20000000-0000-4000-8000-000000000001", public_ref: "WF-T000042", company_id: "company-a", company_name: "Northpoint Logistics", client_profile_id: "client-a", client_name: "Avery Stone", subject: "Need help with the campaign brief", status: "open", priority: "high", assigned_to_profile_id: "staff-a", assigned_to_name: "William", message_count: 2, last_message_at: "2026-08-14T08:00:00Z", created_at: "2026-08-14T07:00:00Z", updated_at: "2026-08-14T08:00:00Z", archived_at: null, inbox_added_at: "2026-08-14T07:30:00Z",
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
  it("leads every mobile Ticket card with the Ticket glyph, keeping all of its information", () => {
    const { container } = render(<TicketsList summaries={[ticket, other]} />);

    const cards = container.querySelectorAll('[class*="mobileList"] > a');
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(card.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(card.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
    // Nothing was traded away for the glyph: reference, subject, client,
    // priority and timestamp all still render inside the card.
    const first = cards[0] as HTMLElement;
    for (const text of ["WF-T000042", ticket.subject, ticket.company_name!, "High"]) {
      expect(first.textContent).toContain(text);
    }
  });

  it("shows the In Inbox state label only on Tickets that are actually in the Inbox", () => {
    const { container } = render(
      <TicketsList summaries={[ticket, { ...other, inbox_added_at: null }]} />,
    );

    const cards = container.querySelectorAll(`[class*="mobileList"] > a`);
    expect(cards.length).toBe(2);
    expect((cards[0] as HTMLElement).textContent).toContain("In Inbox");
    expect((cards[1] as HTMLElement).textContent).not.toContain("In Inbox");
  });

  it("shows the same label inside the desktop table's TICKET column, from the same column", () => {
    const { container } = render(
      <TicketsList summaries={[ticket, { ...other, inbox_added_at: null }]} />,
    );

    const rows = [...container.querySelectorAll(`[class*="tableWrap"] tbody tr`)];
    expect(rows).toHaveLength(2);
    const identityText = (row: Element) => row.querySelector("td")?.textContent ?? "";
    expect(identityText(rows[0]!)).toContain("In Inbox");
    expect(identityText(rows[1]!)).not.toContain("In Inbox");
    // In the TICKET column, after the reference and the subject -- not in
    // STATUS, PRIORITY or a column of its own.
    const cell = rows[0]!.querySelector("td");
    expect(cell).not.toBeNull();
    expect(cell!.querySelectorAll(`[class*="inboxTag"]`)).toHaveLength(1);
    // Last child of the TICKET column's link, i.e. under the subject.
    expect(cell!.querySelector("a")?.lastElementChild?.textContent).toBe("In Inbox");
    expect(cell!.parentElement!.querySelectorAll("td")[2]?.textContent).not.toContain("In Inbox");
  });

  it("searches and filters the authorized summary set", () => {
    render(<TicketsList summaries={[ticket, other]} />);
    fireEvent.change(screen.getByPlaceholderText(/Search ticket ID or person/), { target: { value: "Summit" } });

    expect(screen.getAllByText("WF-T000043").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-T000042").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("No Tickets match your filters.")).toBeInTheDocument();
  });
  it("searches only what belongs to a Ticket: full reference, partial number and person", () => {
    const first: TicketSummary = { ...ticket, public_ref: "WF-TKT-000188", company_name: "Northpoint Logistics", client_name: "Avery Stone" };
    const second: TicketSummary = { ...other, public_ref: "WF-TKT-000200", company_name: "Summit Financial", client_name: "Dana Reyes" };
    render(<TicketsList summaries={[first, second]} />);

    const search = screen.getByPlaceholderText(/Search ticket ID or person/);
    const only = (ref: string, otherRef: string) => {
      expect(screen.getAllByText(ref).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(otherRef).length).toBe(0);
    };

    fireEvent.change(search, { target: { value: "WF-TKT-000188" } });
    only("WF-TKT-000188", "WF-TKT-000200");

    fireEvent.change(search, { target: { value: "000188" } });
    only("WF-TKT-000188", "WF-TKT-000200");

    fireEvent.change(search, { target: { value: "188" } });
    only("WF-TKT-000188", "WF-TKT-000200");

    fireEvent.change(search, { target: { value: "dana reyes" } });
    only("WF-TKT-000200", "WF-TKT-000188");
  });
  it("filters Tickets by Inbox membership from the single inbox_added_at column", () => {
    const inInbox: TicketSummary = { ...ticket, public_ref: "WF-TKT-000188" };
    const notInInbox: TicketSummary = { ...other, public_ref: "WF-TKT-000189", company_name: "Redwood Supply", inbox_added_at: null };
    render(<TicketsList summaries={[inInbox, notInInbox]} />);

    // "All Tickets" is the default, so both memberships render.
    expect(screen.getAllByText("WF-TKT-000188").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WF-TKT-000189").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

    fireEvent.click(screen.getByRole("button", { name: "In Inbox" }));
    expect(screen.getAllByText("WF-TKT-000188").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000189").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Not in Inbox" }));
    expect(screen.getAllByText("WF-TKT-000189").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000188").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "All Tickets" }));
    expect(screen.getAllByText("WF-TKT-000188").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WF-TKT-000189").length).toBeGreaterThan(0);
  });
  it("combines the Inbox filter with status, priority and search without resetting them", () => {
    const openInInbox: TicketSummary = { ...ticket, public_ref: "WF-TKT-000188" };
    const openOutsideInbox: TicketSummary = { ...other, public_ref: "WF-TKT-000189", company_name: "Redwood Supply", status: "open", priority: "high", inbox_added_at: null };
    const closedInInbox: TicketSummary = { ...other, public_ref: "WF-TKT-000190", company_name: "Summit Financial", status: "closed", priority: "normal", inbox_added_at: "2026-08-14T07:30:00Z" };
    render(<TicketsList summaries={[openInInbox, openOutsideInbox, closedInInbox]} />);

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

    // Status alone first: both open Tickets, not the closed one.
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getAllByText("WF-TKT-000188").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WF-TKT-000189").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000190").length).toBe(0);

    // + In Inbox -> only the open, in-Inbox Ticket survives both conditions.
    fireEvent.click(screen.getByRole("button", { name: "In Inbox" }));
    expect(screen.getAllByText("WF-TKT-000188").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000189").length).toBe(0);

    // Swapping Inbox leaves Status standing -- the closed, in-Inbox Ticket
    // never comes back, which it would if Status had been reset.
    fireEvent.click(screen.getByRole("button", { name: "Not in Inbox" }));
    expect(screen.getAllByText("WF-TKT-000189").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000188").length).toBe(0);
    expect(screen.queryAllByText("WF-TKT-000190").length).toBe(0);

    // Priority narrows the same AND-set to nothing.
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    expect(screen.getByText("No Tickets match your filters.")).toBeInTheDocument();

    // Clear filters resets the three groups but leaves the search alone.
    fireEvent.change(screen.getByPlaceholderText(/Search ticket ID or person/), { target: { value: "Summit" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByText("WF-TKT-000190").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("WF-TKT-000188").length).toBe(0);
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
    const { rerender } = render(<TicketComposer target={{ kind: "ticket", ticketId: ticket.ticket_id }} mode="admin" />);
    const replyEditor = screen.getByRole("textbox", { name: "Write a reply" });
    replyEditor.innerHTML = "We are reviewing this now.";
    fireEvent.input(replyEditor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![0]).toMatchObject({
      mode: "admin", target: { kind: "ticket", ticketId: ticket.ticket_id },
    });
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("We are reviewing this now.");
    rerender(<TicketComposer target={{ kind: "ticket", ticketId: ticket.ticket_id }} mode="note" />);
    fireEvent.change(screen.getByPlaceholderText(/private message to your team/i), { target: { value: "Internal context" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(2));
  });
  it("wires resolve, reopen, priority, and assignment operations", async () => {
    const { rerender } = render(<TicketAdminControls ticketId={ticket.ticket_id} status="open" priority="high" assigneeId={null} assignees={[{ id: "staff-a", displayName: "William" }]} capabilities={capabilities} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(actions.updateTicketStatusAction).toHaveBeenCalledWith(ticket.ticket_id, "resolved"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), { target: { value: "urgent" } });
    await waitFor(() => expect(actions.updateTicketPriorityAction).toHaveBeenCalledWith(ticket.ticket_id, "urgent"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole("combobox", { name: "Assigned Wolf Forge member" }), { target: { value: "staff-a" } });
    await waitFor(() => expect(actions.assignTicketAction).toHaveBeenCalledWith(ticket.ticket_id, "staff-a"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3));
    rerender(<TicketAdminControls ticketId={ticket.ticket_id} status="closed" priority="high" assigneeId={null} assignees={[]} capabilities={capabilities} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(actions.updateTicketStatusAction).toHaveBeenCalledWith(ticket.ticket_id, "open"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(4));
  });
});

describe("Client Messages", () => {
  it("renders only client-safe list data and starts a conversation once", async () => {
    render(<ClientMessages summaries={[ticket]} />);
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
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

describe("Order chat: two-sided bubbles and identity", () => {
  it("aligns client and internal-actor messages to opposite sides by actor type", () => {
    const { container } = render(<TicketConversation messages={messages} />);
    const items = container.querySelectorAll("li[data-side]");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-side", "client");
    expect(items[1]).toHaveAttribute("data-side", "internal");
  });

  it("shows the real Order identifier as the header, not a generic label", () => {
    render(<TicketConversation messages={messages} heading="Project #39" />);
    expect(screen.getByRole("heading", { name: "Project #39" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Conversation" })).not.toBeInTheDocument();
  });

  it("renders header actions only when supplied, e.g. never for the client view", () => {
    const { rerender } = render(
      <TicketConversation messages={messages} heading="Project #39" headerActions={<button>Internal notes</button>} />,
    );
    expect(screen.getByRole("button", { name: "Internal notes" })).toBeInTheDocument();

    rerender(<TicketConversation messages={messages} clientView heading="WF-P0039" />);
    expect(screen.queryByRole("button", { name: "Internal notes" })).not.toBeInTheDocument();
  });

  it("hides internal notes from the main thread when hideInternalNotes is set, even for internal viewers", () => {
    render(<TicketConversation messages={messages} hideInternalNotes />);
    expect(screen.getByText("Can you help with the brief?")).toBeInTheDocument();
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
  });
});

describe("Image attachment lightbox", () => {
  const withImage: TicketDetailMessage[] = [
    {
      id: "m-img", ticket_id: ticket.ticket_id, author_profile_id: "client-a", author_name: "Avery Stone",
      author_avatar_url: null, author_type: "client", message_kind: "reply", visibility: "client", body: "",
      created_at: ticket.created_at,
      attachments: [{
        id: "att-1", original_name: "brief.png", mime_type: "image/png", size_bytes: 1024,
        scan_status: "clean", created_at: ticket.created_at,
      }],
    },
  ];

  it("opens as a real modal dialog with full accessibility semantics", () => {
    render(<TicketConversation messages={withImage} />);
    fireEvent.click(screen.getByRole("button", { name: "brief.png" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close image" })).toHaveFocus();
  });

  it("locks background scroll and makes the rest of the page inert while open, restoring both on close", () => {
    render(<TicketConversation messages={withImage} />);
    const trigger = screen.getByRole("button", { name: "brief.png" });
    fireEvent.click(trigger);

    expect(document.body.style.overflow).toBe("hidden");
    const appRoot = trigger.closest("section")?.parentElement;
    expect(appRoot?.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close image" }));

    expect(document.body.style.overflow).not.toBe("hidden");
    expect(appRoot?.hasAttribute("inert")).toBe(false);
  });

  it("closes on Escape and restores focus to the triggering attachment", async () => {
    render(<TicketConversation messages={withImage} />);
    const trigger = screen.getByRole("button", { name: "brief.png" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes on a backdrop click but not on a click inside the dialog card", () => {
    const { container } = render(<TicketConversation messages={withImage} />);
    fireEvent.click(screen.getByRole("button", { name: "brief.png" }));

    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const backdrop = container.ownerDocument.body.querySelector('[class*="imageLightboxBackdrop"]');
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Internal Notes modal", () => {
  const target = { kind: "order" as const, orderId: "30000000-0000-4000-8000-000000000001" };
  const notes: TicketDetailMessage[] = [
    {
      id: "n1",
      ticket_id: ticket.ticket_id,
      author_profile_id: "staff-a",
      author_name: "William",
      author_avatar_url: null,
      author_type: "internal",
      message_kind: "internal_note",
      visibility: "internal",
      body: "Confirm scope before replying.",
      can_unsend: true,
      unsent_at: null,
      created_at: ticket.updated_at,
      attachments: [],
    },
  ];

  it("uses the simplified icon-free project note label, opens existing notes, and lets staff add another", async () => {
    render(<InternalNotesModal target={target} notes={notes} disabled={false} />);

    const trigger = screen.getByRole("button", { name: "View note for this project" });
    expect(trigger.querySelector("svg")).not.toBeInTheDocument();
    fireEvent.click(trigger);

    expect(screen.getByRole("heading", { name: "Internal notes" })).toBeInTheDocument();
    expect(screen.getByText("Confirm scope before replying.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" }).querySelector("svg")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/private message to your team/i), {
      target: { value: "Second note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() =>
      expect(actions.sendTicketComposerAction).toHaveBeenCalled(),
    );
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("Second note");
  });

  it("keeps the simplified label and an honest empty state when there are no notes yet", () => {
    render(<InternalNotesModal target={target} notes={[]} disabled={false} />);

    expect(screen.getByRole("button", { name: "View note for this project" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View note for this project" }));
    expect(screen.getByText("No internal notes yet.")).toBeInTheDocument();
  });

  it("wraps Tab and Shift+Tab inside the notes dialog", () => {
    render(<InternalNotesModal target={target} notes={[]} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View note for this project" }));
    const dialog = screen.getByRole("dialog", { name: "Internal notes" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    const input = within(dialog).getByRole("textbox");
    input.focus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(input).toHaveFocus();
  });

  it("opens the author action by focus or tap, supports Cancel, Escape, and outside dismissal", () => {
    render(<><InternalNotesModal target={target} notes={notes} disabled={false} /><button>Outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: "View note for this project" }));
    const trigger = screen.getByRole("button", { name: "Note actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsend note" }));
    expect(screen.getByRole("alertdialog", { name: "Unsend this note?" })).toBeInTheDocument();
    expect(screen.getByText("The note content will be hidden, but the note will remain in the activity history.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(actions.unsendTicketInternalNoteAction).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("unsends once, refreshes, and renders the persisted tombstone with original identity and time", async () => {
    let finish!: (value: actions.TicketMutationResult) => void;
    vi.mocked(actions.unsendTicketInternalNoteAction).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const { rerender } = render(<InternalNotesModal target={target} notes={notes} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View note for this project" }));
    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsend note" }));
    const unsend = screen.getByRole("button", { name: "Unsend" });
    fireEvent.click(unsend);
    fireEvent.click(unsend);
    expect(actions.unsendTicketInternalNoteAction).toHaveBeenCalledExactlyOnceWith("n1");
    expect(unsend).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(refresh).toHaveBeenCalled();

    const tombstone = [{ ...notes[0]!, body: "This note was unsent.", unsent_at: "2026-09-15T01:00:00Z", can_unsend: false }];
    rerender(<InternalNotesModal target={target} notes={tombstone} disabled={false} />);
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
    const body = screen.getByText("This note was unsent.");
    const note = body.closest("article")!;
    expect(within(note).getByText("William")).toBeInTheDocument();
    expect(note.querySelector("time")).toHaveAttribute("dateTime", ticket.updated_at);
    expect(screen.queryByRole("button", { name: "Note actions" })).not.toBeInTheDocument();
  });

  it("does not offer Unsend for a note the viewer does not own", () => {
    render(<InternalNotesModal target={target} notes={[{ ...notes[0]!, can_unsend: false }]} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View note for this project" }));
    expect(screen.queryByRole("button", { name: "Note actions" })).not.toBeInTheDocument();
  });
});

describe("Order chat final polish", () => {
  const own: TicketDetailMessage = {
    ...messages[0]!, id: "own", author_type: "internal", author_profile_id: "me",
    author_name: "QA Local", author_avatar_url: "https://example.com/me.jpg", body: "Hey",
  };
  const staff: TicketDetailMessage = {
    ...own, id: "staff", author_profile_id: "other", author_name: "William", body: "Staff reply",
  };

  it("uses actor sides, hides own identity/avatar, groups the same actor and excludes private messages", () => {
    render(<TicketConversation orderChat viewerProfileId="me" messages={[
      ...messages, own, { ...own, id: "own2", body: "Another reply" }, staff,
    ]} />);
    expect(screen.getByText("Can you help with the brief?").closest("li")).toHaveAttribute("data-side", "client");
    expect(screen.getByText("Hey").closest("li")).toHaveAttribute("data-side", "internal");
    expect(screen.getByText("Staff reply").closest("li")).toHaveAttribute("data-side", "internal");
    expect(screen.getByText("Another reply").closest("li")).toHaveAttribute("data-grouped", "true");
    expect(screen.queryByText("QA Local")).not.toBeInTheDocument();
    const ownRow = screen.getByText("Hey").closest("li")!;
    expect(within(ownRow).queryByTestId("ticket-avatar-image")).not.toBeInTheDocument();
    expect(within(ownRow).queryByTestId("ticket-avatar-fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
    expect(screen.getByText("Hey").closest("li")?.querySelector("time")).toHaveAttribute("dateTime", own.created_at);
  });

  it("shows real client identity: avatar/initials, name, and a timestamp directly under the name", () => {
    render(<TicketConversation orderChat viewerProfileId="me" messages={[messages[0]!]} />);
    const clientRow = screen.getByText("Can you help with the brief?").closest("li")!;
    expect(clientRow).toHaveAttribute("data-side", "client");
    expect(within(clientRow).getByTestId("ticket-avatar-fallback")).toHaveTextContent("AS");
    expect(within(clientRow).getByText("Avery Stone")).toBeInTheDocument();
    expect(screen.queryByText(/replied/i)).not.toBeInTheDocument();

    const identityTime = clientRow.querySelector(`time[datetime="${messages[0]!.created_at}"]`)!;
    expect(identityTime).toBeInTheDocument();
    const bubble = within(clientRow).getByText("Can you help with the brief?");
    expect(identityTime.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const layout = clientRow.firstElementChild!;
    const messageStack = bubble.closest('[class*="messageStack"]')!;
    expect(layout).toContainElement(within(clientRow).getByTestId("ticket-avatar-fallback"));
    expect(layout.contains(messageStack)).toBe(true);
    expect(messageStack.compareDocumentPosition(identityTime) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("uses a real stored avatar for a client message when one exists", () => {
    render(<TicketConversation orderChat messages={[
      { ...messages[0]!, author_avatar_url: "https://example.com/client.jpg" },
    ]} />);
    const clientRow = screen.getByText("Can you help with the brief?").closest("li")!;
    expect(within(clientRow).getByTestId("ticket-avatar-image")).toHaveAttribute(
      "src", "https://example.com/client.jpg",
    );
  });

  it("keeps grouped client replies compact: no repeated avatar/name/timestamp block", () => {
    const first = messages[0]!;
    const secondSameClient = { ...first, id: "m1b", body: "Second client message", created_at: "2026-08-14T07:02:00Z" };
    render(<TicketConversation orderChat messages={[first, secondSameClient]} />);
    const groupedRow = screen.getByText("Second client message").closest("li")!;
    expect(groupedRow).toHaveAttribute("data-grouped", "true");
    expect(within(groupedRow).queryByTestId("ticket-avatar-fallback")).not.toBeInTheDocument();
    expect(within(groupedRow).queryByText("Avery Stone")).not.toBeInTheDocument();
    expect(groupedRow.querySelector(`time[datetime="${secondSameClient.created_at}"]`)).toBeInTheDocument();
  });

  it("never renders private header actions in client view, even if supplied", () => {
    render(<TicketConversation orderChat clientView messages={messages} headerActions={<button>Internal notes (1)</button>} />);
    expect(screen.queryByRole("button", { name: /Internal notes/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm scope before replying.")).not.toBeInTheDocument();
  });

  it("copies the selected canonical message and offers no unsupported or task actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TicketConversation orderChat viewerProfileId="me" messages={[own, staff]} />);
    const ownRow = screen.getByText("Hey").closest("li")!;
    const trigger = within(ownRow).getByRole("button", { name: "Message actions" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Message actions" });
    const copy = within(menu).getByRole("menuitem", { name: "Copy" });
    expect(copy).toHaveFocus();
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Reply|Forward|Pin|Delete|Create Task|React/ })).not.toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("Hey"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(within(ownRow).getByRole("status")).toHaveTextContent("Message copied.");
  });

  it("keeps copy failures actionable and supports Escape, arrow keys and outside dismissal", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    } });
    render(<><TicketConversation orderChat messages={[own]} /><button>Outside</button></>);
    const trigger = screen.getByRole("button", { name: "Message actions" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not copy"));
    fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("removes the attached composer heading while preserving rich text and the real send action", async () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    expect(screen.queryByText("Reply", { exact: true })).not.toBeInTheDocument();
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "<b>Ready</b>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("**Ready**");
  });
});

describe("Ticket client view: chat alignment and actions", () => {
  const clientMsg: TicketDetailMessage = {
    ...messages[0]!, id: "cv-client", body: "Can you help with the brief?",
  };
  const staffReply: TicketDetailMessage = {
    ...messages[1]!, id: "cv-staff", message_kind: "reply", visibility: "client", body: "Sure, sending it now.",
  };

  it("gives the client's own message the own/right-side treatment and Wolf Forge's the other/left-side treatment", () => {
    render(<TicketConversation orderChat clientView messages={[clientMsg, staffReply]} />);
    const ownRow = screen.getByText("Can you help with the brief?").closest("li")!;
    const staffRow = screen.getByText("Sure, sending it now.").closest("li")!;
    expect(ownRow).toHaveAttribute("data-side", "client");
    expect(ownRow).toHaveAttribute("data-own", "true");
    expect(staffRow).toHaveAttribute("data-side", "internal");
    expect(staffRow).not.toHaveAttribute("data-own");
  });

  it("offers Reply and Copy on the client's own message, but no React, Forward, or internal-note controls", () => {
    render(<TicketConversation orderChat clientView messages={[clientMsg, staffReply]} onReply={vi.fn()} />);
    const ownRow = screen.getByText("Can you help with the brief?").closest("li")!;
    fireEvent.click(within(ownRow).getByRole("button", { name: "Message actions" }));
    const menu = screen.getByRole("menu", { name: "Message actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Reply", "Copy"]);
    expect(screen.queryByRole("menuitem", { name: "React" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Forward" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Internal notes/ })).not.toBeInTheDocument();
  });

  it("calls onReply with the client's own message when Reply is chosen", () => {
    const onReply = vi.fn();
    render(<TicketConversation orderChat clientView messages={[clientMsg, staffReply]} onReply={onReply} />);
    const ownRow = screen.getByText("Can you help with the brief?").closest("li")!;
    fireEvent.click(within(ownRow).getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));
    expect(onReply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: "cv-client" }));
  });
});

describe("Order persisted message actions", () => {
  const source: TicketDetailMessage = {
    ...messages[0]!,
    id: "source-message",
    body: "Thanks, the postcard should arrive Thursday.",
    reactions: [],
  };
  const destinations = [
    {
      conversationId: "direct-chat",
      kind: "direct" as const,
      name: "William",
      imageUrl: null,
      memberCount: 2,
      otherMember: null,
      lastMessageId: null,
      lastMessageType: null,
      lastAuthorProfileId: null,
      lastAuthorName: null,
      lastAuthorAvatarUrl: null,
      preview: null,
      lastMessageAt: null,
      unreadCount: 0,
      hasUnread: false,
      destinationSearchText: "William",
    },
    {
      conversationId: "group-chat",
      kind: "group" as const,
      name: "Order QA",
      imageUrl: null,
      memberCount: 3,
      otherMember: null,
      lastMessageId: null,
      lastMessageType: null,
      lastAuthorProfileId: null,
      lastAuthorName: null,
      lastAuthorAvatarUrl: null,
      preview: null,
      lastMessageAt: null,
      unreadCount: 0,
      hasUnread: false,
      destinationSearchText: "Order QA",
    },
  ];

  function renderActions(message = source) {
    return render(
      <OrderConversation
        orderId="order-1"
        heading="Project #41"
        messages={[message]}
        viewerProfileId="me"
        destinations={destinations}
        canReply
        repliesDisabled={false}
      />,
    );
  }

  it("orders real actions, persists a specific reply, and renders its saved source preview", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const menu = screen.getByRole("menu", { name: "Message actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Reply", "React", "Forward", "Copy",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reply" }));
    expect(screen.getByText("Replying to Avery Stone")).toBeInTheDocument();
    expect(screen.getAllByText(source.body)).toHaveLength(2);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.textContent = "It is scheduled.";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![0]).toMatchObject({
      replyTo: { ticketId: source.ticket_id, messageId: source.id },
    });

    cleanup();
    renderActions({
      ...source,
      id: "persisted-reply",
      body: "It is scheduled.",
      reply_to_message_id: source.id,
      reply_quote_text: source.body,
      reply_source_author_name: "QA Order Client",
      reply_source_available: true,
    });
    expect(screen.getByText("QA Order Client")).toBeInTheDocument();
    expect(screen.getByText(source.body)).toBeInTheDocument();
  });

  it("renders persisted reactions outside the bubble on both actor sides and keeps toggling through the Ticket RPC", async () => {
    renderActions({
      ...source,
      reactions: [{ reaction_code: "heart", reaction_count: 2, reacted_by_me: true, reactor_names: ["William", "Avery"] }],
    });
    const clientRow = screen.getByText(source.body).closest("li")!;
    const clientBubble = screen.getByText(source.body).closest('[tabindex="0"]')!;
    const clientReactions = within(clientRow).getByRole("group", { name: "Message reactions" });
    expect(clientRow).toHaveAttribute("data-side", "client");
    expect(clientBubble).not.toContainElement(clientReactions);
    expect(clientReactions.parentElement).toBe(clientBubble.parentElement);
    expect(within(clientReactions).getByRole("button", { name: /Heart.*2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "React" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Heart" }));
    await waitFor(() => expect(actions.toggleTicketMessageReactionAction).toHaveBeenCalledExactlyOnceWith(source.id, "heart"));
    expect(refresh).toHaveBeenCalled();

    cleanup();
    renderActions({
      ...source,
      id: "internal-reaction",
      author_type: "internal",
      author_profile_id: "me",
      author_name: "QA Local",
      body: "Internal update",
      reactions: [{ reaction_code: "heart", reaction_count: 1, reacted_by_me: false, reactor_names: ["William"] }],
    });
    const internalRow = screen.getByText("Internal update").closest("li")!;
    const internalBubble = screen.getByText("Internal update").closest('[tabindex="0"]')!;
    const internalReactions = within(internalRow).getByRole("group", { name: "Message reactions" });
    expect(internalRow).toHaveAttribute("data-side", "internal");
    expect(internalBubble).not.toContainElement(internalReactions);
    expect(internalReactions.parentElement).toBe(internalBubble.parentElement);
  });

  it.each([
    ["William", "direct-chat"],
    ["Order QA", "group-chat"],
  ])("reviews before forwarding to %s and sends one Team message with the optional comment", async (name, id) => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Forward" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Forward message" })).getByRole("button", { name: new RegExp(name) }));
    expect(actions.forwardTicketMessageToTeamAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: `Forward to: ${name}` })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Add a message" }), { target: { value: "Please review." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(actions.forwardTicketMessageToTeamAction).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      sourceMessageId: source.id,
      destinationConversationId: id,
      comment: "Please review.",
    }));
    expect(screen.queryByRole("dialog", { name: "Forward message" })).not.toBeInTheDocument();
  });

  it("keeps the review and comment after failure and blocks duplicate sends while pending", async () => {
    let finish!: (value: actions.TicketMutationResult) => void;
    vi.mocked(actions.forwardTicketMessageToTeamAction).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: /William/ }));
    const comment = screen.getByRole("textbox", { name: "Add a message" });
    fireEvent.change(comment, { target: { value: "Keep this draft" } });
    const send = screen.getByRole("button", { name: "Send" });
    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(actions.forwardTicketMessageToTeamAction).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, error: "Sending is unavailable." }));
    expect(screen.getByRole("dialog", { name: "Forward message" })).toBeInTheDocument();
    expect(comment).toHaveValue("Keep this draft");
    expect(screen.getByRole("alert")).toHaveTextContent("Sending is unavailable.");
  });
});

describe("Order send pending and recovery", () => {
  function compose() {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "<b>Hello</b>";
    fireEvent.input(editor);
    return { editor, form: editor.closest("form")! };
  }

  it("blocks rapid duplicate submits and clears only after the confirmed response", async () => {
    let finish!: (value: actions.TicketMutationResult) => void;
    vi.mocked(actions.sendTicketComposerAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { editor, form } = compose();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(form).toHaveAttribute("data-sending", "true");
    expect(editor).toHaveTextContent("Hello");
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(form).not.toHaveAttribute("data-sending");
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
  });

  it("preserves formatted text on server failure and clears it on successful retry", async () => {
    vi.mocked(actions.sendTicketComposerAction).mockResolvedValueOnce({ ok: false, error: "Sending is unavailable." });
    const { editor, form } = compose();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Sending is unavailable."));
    expect(editor.innerHTML).toBe("<b>Hello</b>");
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled());
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(actions.sendTicketComposerAction).mock.calls;
    expect(calls[1]).toEqual(calls[0]);
  });

  it("recovers from transport failure and uses a new request key if the draft is changed", async () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce("10000000-0000-4000-8000-000000000010");
    vi.mocked(crypto.randomUUID).mockReturnValueOnce("10000000-0000-4000-8000-000000000011");
    vi.mocked(actions.sendTicketComposerAction).mockRejectedValueOnce(new Error("transport"));
    const { editor, form } = compose();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not confirm sending"));
    expect(editor.innerHTML).toBe("<b>Hello</b>");
    editor.textContent = "Updated draft";
    fireEvent.input(editor);
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(actions.sendTicketComposerAction).mock.calls;
    expect(calls[1]![0].requestId).not.toBe(calls[0]![0].requestId);
    expect(calls[1]![1].get("body")).toBe("Updated draft");
  });
});

describe("Order chat optimistic send", () => {
  function renderConversation(initialMessages: TicketDetailMessage[] = []) {
    return render(
      <OrderConversation
        orderId="order-1"
        heading="Project #41"
        messages={initialMessages}
        viewerProfileId="me"
        destinations={[]}
        canReply
        repliesDisabled={false}
      />,
    );
  }

  it("shows an outgoing bubble immediately, clears the composer, and reconciles only once the refresh lands", async () => {
    let finish!: (value: actions.TicketMutationResult) => void;
    vi.mocked(actions.sendTicketComposerAction).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const { rerender } = renderConversation();
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.textContent = "On it now.";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Sending..." })).not.toBeInTheDocument();
    expect(screen.getByText("On it now.")).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();

    await act(async () => finish({ ok: true }));
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(screen.getAllByText("On it now.")).toHaveLength(1);

    const canonical: TicketDetailMessage = {
      id: "m-real", ticket_id: ticket.ticket_id, author_profile_id: "me", author_name: "William", author_avatar_url: null,
      author_type: "internal", message_kind: "reply", visibility: "client", body: "On it now.", created_at: "2026-08-14T09:00:00Z", attachments: [],
    };
    rerender(
      <OrderConversation
        orderId="order-1"
        heading="Project #41"
        messages={[canonical]}
        viewerProfileId="me"
        destinations={[]}
        canReply
        repliesDisabled={false}
      />,
    );
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.getAllByText("On it now.")).toHaveLength(1);
  });

  it("marks a failed send with a retry affordance that resends the same request id", async () => {
    vi.mocked(actions.sendTicketComposerAction).mockResolvedValueOnce({ ok: false, error: "down" });
    renderConversation();
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.textContent = "Retry me.";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Not sent/ })).toBeInTheDocument());

    vi.mocked(actions.sendTicketComposerAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: /Not sent/ }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(2));
    const [firstCall, secondCall] = vi.mocked(actions.sendTicketComposerAction).mock.calls;
    expect(secondCall![0].requestId).toBe(firstCall![0].requestId);
  });
});

describe("Composer Ctrl+Enter send shortcut", () => {
  it("Ctrl+Enter sends exactly once via the same canonical action as clicking Send", async () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "<b>Shortcut send</b>";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("**Shortcut send**");
  });

  it("Ctrl+Shift+Enter still sends as a compatibility alias, via the same canonical action", async () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "<b>Legacy shortcut send</b>";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("**Legacy shortcut send**");
  });

  it("plain Enter does not submit", () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "Draft text";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(actions.sendTicketComposerAction).not.toHaveBeenCalled();
  });

  it("Shift+Enter (no Ctrl) does not submit, preserving newline/editor behavior", () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "Draft text";
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(actions.sendTicketComposerAction).not.toHaveBeenCalled();
  });

  it("respects the empty-draft guard instead of bypassing validation", () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(actions.sendTicketComposerAction).not.toHaveBeenCalled();
  });
});

describe("Ticket composer attachments", () => {
  const renderComposer = () => render(
    <TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />,
  );
  const pdf = () => new File(["%PDF-1.7"], "brief.pdf", { type: "application/pdf" });

  it("keeps Add file immediately beside Send reply and opens the native picker", () => {
    const { container } = renderComposer();
    const add = screen.getByRole("button", { name: "Add file" });
    const send = screen.getByRole("button", { name: "Send reply" });
    expect(add.parentElement).toBe(send.parentElement);
    expect(add.nextElementSibling).toBe(send);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(add);
    expect(click).toHaveBeenCalledOnce();
  });

  it("previews and removes a selected draft file without sending", () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf()] } });
    expect(screen.getByText("brief.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove brief.pdf" }));
    expect(screen.queryByText("brief.pdf")).not.toBeInTheDocument();
    expect(actions.sendTicketComposerAction).not.toHaveBeenCalled();
  });

  it("sends file-only and text-plus-file drafts through the same action", async () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf()] } });
    const send = screen.getByRole("button", { name: "Send reply" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("attachment")).toBeInstanceOf(File);
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("");

    const nextInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(nextInput, { target: { files: [pdf()] } });
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.textContent = "See attached.";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[1]![1].get("body")).toBe("See attached.");
  });

  it("retains a selected file when sending fails", async () => {
    vi.mocked(actions.sendTicketComposerAction).mockResolvedValueOnce({ ok: false, error: "Upload failed." });
    const { container } = renderComposer();
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Upload failed."));
    expect(screen.getByText("brief.pdf")).toBeInTheDocument();
  });
});

describe("Ticket admin compact composer", () => {
  const renderCompact = (contactName: string | null = "Avery Stone") => render(
    <TicketComposer target={{ kind: "ticket", ticketId: ticket.ticket_id }} mode="admin" attached compact contactName={contactName} />,
  );

  it("shows the real contact name in the placeholder and accessible name", () => {
    renderCompact("Avery Stone");
    expect(screen.getByRole("textbox", { name: "Message Avery Stone..." })).toBeInTheDocument();
  });

  it("falls back to a neutral placeholder when no contact name is available", () => {
    renderCompact(null);
    expect(screen.getByRole("textbox", { name: "Message client..." })).toBeInTheDocument();
  });

  it("renders icon-only Add file and Send reply buttons with no visible label text", () => {
    renderCompact();
    const add = screen.getByRole("button", { name: "Add file" });
    const send = screen.getByRole("button", { name: "Send reply" });
    expect(add).toHaveTextContent("");
    expect(send).toHaveTextContent("");
  });

  it("sends through the same action as the non-compact composer", async () => {
    renderCompact();
    const editor = screen.getByRole("textbox", { name: "Message Avery Stone..." });
    editor.textContent = "Compact reply";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(actions.sendTicketComposerAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.sendTicketComposerAction).mock.calls[0]![1].get("body")).toBe("Compact reply");
  });

  it("leaves the non-compact composer's placeholder and labeled buttons unchanged", () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add file" })).toHaveTextContent("Add file");
    expect(screen.getByRole("button", { name: "Send reply" })).toHaveTextContent("Send reply");
  });

  it("shows a short Ctrl+Enter hint and no character count", () => {
    renderCompact();
    expect(screen.getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(screen.queryByText(/50,000/)).not.toBeInTheDocument();
  });

  it("leaves the non-compact composer's character count and shortcut hint unchanged", () => {
    render(<TicketComposer target={{ kind: "order", orderId: ticket.ticket_id }} mode="admin" attached />);
    expect(screen.getByText(/50,000/)).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+Enter to send")).toBeInTheDocument();
  });
});

describe("Project and Ticket composers share one canonical toolbar", () => {
  const TOOLBAR_ACTIONS = [
    "Bold", "Italic", "Add link", "Heading", "Bulleted list", "Numbered list", "Undo", "Redo",
  ];

  function toolbarActionsIn(toolbar: HTMLElement) {
    return within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  }

  it("renders the same toolbar actions, in the same single-row grouping, for both surfaces", () => {
    const { container: ticketContainer } = render(
      <TicketComposer target={{ kind: "ticket", ticketId: ticket.ticket_id }} mode="admin" />,
    );
    const ticketToolbar = screen.getByLabelText("Reply formatting");
    expect(toolbarActionsIn(ticketToolbar)).toEqual(TOOLBAR_ACTIONS);
    const ticketUndo = screen.getByRole("button", { name: "Undo" });
    expect(ticketUndo.parentElement!.parentElement).toBe(ticketToolbar);
    expect(ticketContainer.querySelectorAll('[aria-label="Reply formatting"]')).toHaveLength(1);
    cleanup();

    render(
      <OrderConversation
        orderId="order-1"
        heading="Project #41"
        messages={[]}
        viewerProfileId="me"
        destinations={[]}
        canReply
        repliesDisabled={false}
      />,
    );
    const orderToolbar = screen.getByLabelText("Reply formatting");
    expect(toolbarActionsIn(orderToolbar)).toEqual(TOOLBAR_ACTIONS);
    const orderUndo = screen.getByRole("button", { name: "Undo" });
    expect(orderUndo.parentElement!.parentElement).toBe(orderToolbar);
  });
});

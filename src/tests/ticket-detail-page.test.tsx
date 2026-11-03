/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as actions from "../app/actions/tickets";
import type { TicketDetail, TicketDetailMessage, TicketSummary } from "../domain/tickets/schema";

const getInternalContext = vi.fn();
const refresh = vi.fn();

vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: () => getInternalContext(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/*
 * The whole action module, not just the one call this page makes: TicketInspector
 * and TicketAdminControls reach into the same module, and pulling the real one in
 * would drag next/cache and the server Supabase client into a jsdom graph.
 */
vi.mock("../app/actions/tickets", () => ({
  sendTicketComposerAction: vi.fn(),
  adminReplyTicketAction: vi.fn(), clientReplyTicketAction: vi.fn(), addTicketInternalNoteAction: vi.fn(),
  adminSendOrderMessageAction: vi.fn(), clientSendOrderMessageAction: vi.fn(),
  adminReplyToTicketMessageAction: vi.fn(), clientReplyToTicketMessageAction: vi.fn(),
  toggleTicketMessageReactionAction: vi.fn(), forwardTicketMessageToTeamAction: vi.fn(),
  unsendTicketInternalNoteAction: vi.fn(),
  createClientTicketAction: vi.fn(), createInternalTicketAction: vi.fn(),
  updateTicketStatusAction: vi.fn(), updateTicketPriorityAction: vi.fn(), assignTicketAction: vi.fn(),
  addTicketToInboxAction: vi.fn(),
  listTicketSummariesAction: vi.fn(), getTicketInboxConversationAction: vi.fn(),
  listTicketAssigneesAction: vi.fn(),
}));

const TicketDetailPage = (await import("../app/(internal)/tickets/[ticketId]/page")).default;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    /* The real element dispatches `close`; without it a stub close would never
       reach React's onClose and the flow would look broken in jsdom only. */
    this.dispatchEvent(new Event("close"));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function message(overrides: Partial<TicketDetailMessage> = {}): TicketDetailMessage {
  return {
    id: "m1",
    ticket_id: "t1",
    author_profile_id: "p1",
    author_name: "Client Person",
    author_avatar_url: null,
    author_type: "client",
    message_kind: "reply",
    visibility: "client",
    body: "Latest client reply body",
    created_at: "2026-09-17T10:00:00Z",
    attachments: [],
    ...overrides,
  };
}

function detail(overrides: Partial<TicketDetail> = {}, messages = [message()]): TicketDetail {
  return {
    ticket: {
      id: "t1",
      public_ref: "TCK-1",
      subject: "Billing question",
      status: "open",
      priority: "normal",
      requester_name: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-17T10:00:00Z",
      resolved_at: null,
      closed_at: null,
      archived_at: null,
      inbox_added_at: null,
    },
    company_name: "Acme Co",
    client_name: "Client Person",
    assigned_to_name: null,
    messages,
    ...overrides,
  };
}

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    ticket_id: "t1",
    public_ref: "TCK-1",
    company_id: null,
    company_name: "Acme Co",
    client_profile_id: null,
    client_name: "Client Person",
    subject: "Billing question",
    status: "open",
    priority: "normal",
    assigned_to_profile_id: null,
    assigned_to_name: null,
    message_count: 1,
    last_message_at: "2026-09-17T10:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-17T10:00:00Z",
    archived_at: null,
    inbox_added_at: null,
    ...overrides,
  };
}

function context(
  overrides: {
    reply?: boolean;
    edit?: boolean;
    internalNotes?: boolean;
    summaries?: TicketSummary[];
    detail?: TicketDetail;
  } = {},
) {
  return {
    user: {
      id: "staff-1",
      tickets: {
        view: true,
        reply: overrides.reply ?? true,
        internalNotes: overrides.internalNotes ?? false,
        edit: overrides.edit ?? true,
        assign: true,
        create: true,
        archive: true,
      },
    },
    services: {
      tickets: {
        get: vi.fn().mockResolvedValue(overrides.detail ?? detail()),
        list: vi.fn().mockResolvedValue(overrides.summaries ?? [summary()]),
      },
      catalog: { listAssignees: vi.fn().mockResolvedValue([]) },
    },
  };
}

async function renderPage(ticketId = "t1") {
  const jsx = await TicketDetailPage({ params: Promise.resolve({ ticketId }) });
  return render(jsx);
}

describe("Ticket management page — no conversation", () => {
  it("renders the management surface: details, Operations, and the Inbox control", async () => {
    getInternalContext.mockResolvedValue(context());
    await renderPage();

    expect(screen.getByRole("heading", { name: "Ticket details" })).toBeInTheDocument();
    // Once in the Ticket list, once in the Client / company row.
    expect(screen.getAllByText("Acme Co").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned Wolf Forge member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it("renders no transcript, even though the Ticket has messages", async () => {
    getInternalContext.mockResolvedValue(
      context({ detail: detail({}, [message({ body: "Latest client reply body" })]) }),
    );
    await renderPage();

    expect(screen.queryByText("Latest client reply body")).not.toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  it("renders no reply composer", async () => {
    getInternalContext.mockResolvedValue(context({ reply: true }));
    await renderPage();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^Message /)).not.toBeInTheDocument();
  });

  it("keeps the Ticket list for switching, with the current Ticket marked current", async () => {
    getInternalContext.mockResolvedValue(
      context({
        summaries: [
          summary({ ticket_id: "t1", subject: "Billing question" }),
          summary({ ticket_id: "t2", subject: "Shipping delay" }),
        ],
      }),
    );
    await renderPage();

    const current = screen.getByRole("link", { name: /Billing question/ });
    const other = screen.getByRole("link", { name: /Shipping delay/ });
    expect(current).toHaveAttribute("href", "/tickets/t1");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(other).toHaveAttribute("href", "/tickets/t2");
    expect(other).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /All Tickets/ })).toHaveAttribute("href", "/tickets");
  });

  it("marks selector rows that are already in the Inbox, and leaves the rest unmarked", async () => {
    getInternalContext.mockResolvedValue(
      context({
        summaries: [
          summary({ ticket_id: "t1", subject: "Billing question", inbox_added_at: "2026-09-18T09:00:00Z" }),
          summary({ ticket_id: "t2", subject: "Shipping delay", inbox_added_at: null }),
        ],
      }),
    );
    const { container } = await renderPage();

    const rowText = (href: string) =>
      (container.querySelector(`a[href="${href}"]`) as HTMLElement).textContent ?? "";
    expect(rowText("/tickets/t1")).toContain("In Inbox");
    expect(rowText("/tickets/t2")).not.toContain("In Inbox");
  });

  it("leads every selector row with the Ticket glyph, and the page heading with none", async () => {
    getInternalContext.mockResolvedValue(
      context({
        summaries: [
          summary({ ticket_id: "t1", subject: "Billing question" }),
          summary({ ticket_id: "t2", subject: "Shipping delay" }),
        ],
      }),
    );
    const { container } = await renderPage();

    const rows = container.querySelectorAll("a[href^='/tickets/']");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(row.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }

    // The request was for the LIST rows only; the large detail heading keeps
    // no icon.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.querySelector("svg")).toBeNull();
  });

  it("gates Internal notes on the internalNotes capability, via the shared TicketInspector", async () => {
    getInternalContext.mockResolvedValue(context({ internalNotes: false }));
    await renderPage();
    expect(screen.queryAllByText(/Internal notes/)).toHaveLength(0);

    cleanup();

    getInternalContext.mockResolvedValue(context({ internalNotes: true }));
    await renderPage();
    expect(screen.queryAllByText(/Internal notes/).length).toBeGreaterThan(0);
  });
});

describe("Add to Ticket conversation", () => {
  const openDialog = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add to Ticket conversation" }));
  };
  const confirm = () => screen.getByRole("button", { name: "Add to Inbox" });

  it("shows the CTA while the Ticket is not in the Inbox", async () => {
    getInternalContext.mockResolvedValue(context());
    await renderPage();

    expect(
      screen.getByRole("button", { name: "Add to Ticket conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View in Inbox" })).not.toBeInTheDocument();
  });

  it("hides the CTA from staff without tickets.edit, without hiding the Inbox state", async () => {
    getInternalContext.mockResolvedValue(
      context({
        edit: false,
        detail: detail({
          ticket: { ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z" },
        }),
      }),
    );
    await renderPage();

    expect(screen.queryByRole("button", { name: "Add to Ticket conversation" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in Inbox" })).toBeInTheDocument();
  });

  it("opens the confirmation phase instead of writing on the first click", async () => {
    getInternalContext.mockResolvedValue(context());
    await renderPage();

    await openDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Add this Ticket to Inbox?")).toBeInTheDocument();
    expect(actions.addTicketToInboxAction).not.toHaveBeenCalled();
    // No acknowledgement before any write has happened.
    expect(screen.queryByText("Ticket added to Inbox")).not.toBeInTheDocument();
  });

  it("cancel closes the dialog and writes nothing", async () => {
    getInternalContext.mockResolvedValue(context());
    await renderPage();

    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(actions.addTicketToInboxAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add to Ticket conversation" })).toBeInTheDocument();
  });

  it("shows a restrained loading state in flight, with both controls disabled", async () => {
    getInternalContext.mockResolvedValue(context());
    let resolve: (value: { ok: true }) => void = () => {};
    vi.mocked(actions.addTicketToInboxAction).mockImplementation(
      () => new Promise((settle) => { resolve = settle; }),
    );
    await renderPage();

    await openDialog();
    fireEvent.click(confirm());

    const submit = await screen.findByRole("button", { name: /Adding/ });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // Still the confirmation, and still open: the write is not acknowledged yet.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Ticket added to Inbox")).not.toBeInTheDocument();

    resolve({ ok: true });
    await waitFor(() => expect(screen.getByText("Ticket added to Inbox")).toBeInTheDocument());
  });

  it("double-clicking confirm submits one write, not two", async () => {
    getInternalContext.mockResolvedValue(context());
    let resolve: (value: { ok: true }) => void = () => {};
    vi.mocked(actions.addTicketToInboxAction).mockImplementation(
      () => new Promise((settle) => { resolve = settle; }),
    );
    await renderPage();

    await openDialog();
    const button = screen.getByRole("button", { name: "Add to Inbox" });
    fireEvent.click(button);
    fireEvent.click(button);

    resolve({ ok: true });
    await waitFor(() => {
      expect(actions.addTicketToInboxAction).toHaveBeenCalledTimes(1);
    });
  });

  it("acknowledges the write, then revalidates -- in that order, and only on success", async () => {
    getInternalContext.mockResolvedValue(context());
    vi.mocked(actions.addTicketToInboxAction).mockResolvedValue({ ok: true });
    await renderPage();

    await openDialog();
    fireEvent.click(confirm());

    await waitFor(() => {
      expect(actions.addTicketToInboxAction).toHaveBeenCalledWith("t1");
    });
    await waitFor(() => expect(screen.getByText("Ticket added to Inbox")).toBeInTheDocument());
    expect(screen.getByText("This ticket is now available in Inbox → Tickets.")).toBeInTheDocument();
    // The acknowledgement is still on screen, so the page has not been
    // revalidated underneath it yet.
    expect(refresh).not.toHaveBeenCalled();

    // ...and it does arrive, off the bounded timer rather than an animation event.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("a failed add keeps the dialog open, never shows success, and re-enables both controls", async () => {
    getInternalContext.mockResolvedValue(context());
    vi.mocked(actions.addTicketToInboxAction).mockResolvedValue({
      ok: false,
      error: "You do not have permission to manage Ticket conversations.",
    });
    await renderPage();

    await openDialog();
    fireEvent.click(confirm());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to manage Ticket conversations.",
      );
    });
    expect(screen.queryByText("Ticket added to Inbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Inbox" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "View in Inbox" })).not.toBeInTheDocument();
  });

  it("reopening after a success starts from the confirmation again, not the stale acknowledgement", async () => {
    getInternalContext.mockResolvedValue(context());
    vi.mocked(actions.addTicketToInboxAction).mockResolvedValue({ ok: true });
    await renderPage();

    await openDialog();
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText("Ticket added to Inbox")).toBeInTheDocument());

    // The dialog stays mounted across the acknowledgement; opening it again has
    // to reset the phase rather than showing the previous result.
    await openDialog();
    expect(screen.getByText("Add this Ticket to Inbox?")).toBeInTheDocument();
    expect(screen.queryByText("Ticket added to Inbox")).not.toBeInTheDocument();
  });
});

describe("View in Inbox", () => {
  it("keeps a legacy-visible Ticket openable and available to save personally", async () => {
    getInternalContext.mockResolvedValue(
      context({ detail: detail({ ticket: { ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z" } }) }),
    );
    await renderPage();

    expect(screen.getByRole("link", { name: "View in Inbox" })).toHaveAttribute("href", "/tickets/t1?inbox=tickets&ticket=t1");
    fireEvent.click(screen.getByRole("button", { name: "Save to my Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));
    await waitFor(() => expect(actions.addTicketToInboxAction).toHaveBeenCalledWith("t1"));
  });

  it("does not offer a personal save to read-only staff on a legacy-visible Ticket", async () => {
    getInternalContext.mockResolvedValue(context({ edit: false, detail: detail({
      ticket: { ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z" },
    }) }));
    await renderPage();
    expect(screen.getByRole("link", { name: "View in Inbox" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to my Inbox" })).not.toBeInTheDocument();
    expect(screen.getByText(/You have not saved this Ticket personally/)).toBeInTheDocument();
  });

  it("holds the success dialog while refreshed props confirm the personal save", async () => {
    getInternalContext.mockResolvedValue(context({ detail: detail({
      ticket: { ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z" },
    }) }));
    vi.mocked(actions.addTicketToInboxAction).mockResolvedValue({ ok: true });
    const { rerender } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save to my Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));
    await waitFor(() => expect(screen.getByText("Ticket added to Inbox")).toBeInTheDocument());

    getInternalContext.mockResolvedValue(context({ detail: detail({ ticket: {
      ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z", personal_inbox_added_at: "2026-11-04T00:00:00Z",
    } }) }));
    rerender(await TicketDetailPage({ params: Promise.resolve({ ticketId: "t1" }) }));
    expect(screen.getByRole("dialog", { name: "Ticket added to Inbox" })).toBeInTheDocument();
    expect(screen.queryByText(/Saved to your Inbox/)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("replaces the save CTA only once the viewer personally saved the Ticket", async () => {
    getInternalContext.mockResolvedValue(
      context({ detail: detail({ ticket: { ...detail().ticket, inbox_added_at: "2026-09-18T09:00:00Z", personal_inbox_added_at: "2026-11-04T00:00:00Z" } }) }),
    );
    await renderPage();

    expect(screen.queryByRole("button", { name: "Add to Ticket conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to my Inbox" })).not.toBeInTheDocument();
    expect(screen.getByText(/Saved to your Inbox/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in Inbox" })).toBeInTheDocument();
  });

  it("deep-links the Inbox at this exact Ticket through the drawer's existing URL contract", async () => {
    getInternalContext.mockResolvedValue(
      context({
        detail: detail({
          ticket: { ...detail().ticket, id: "t42", inbox_added_at: "2026-09-18T09:00:00Z" },
        }),
      }),
    );
    await renderPage("t42");

    expect(screen.getByRole("link", { name: "View in Inbox" })).toHaveAttribute(
      "href",
      "/tickets/t42?inbox=tickets&ticket=t42",
    );
  });
});

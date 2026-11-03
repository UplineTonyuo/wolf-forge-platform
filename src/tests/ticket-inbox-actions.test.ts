import { describe, expect, it, vi } from "vitest";

const getInternalContext = vi.fn();

vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: () => getInternalContext(),
}));

/* refreshTicket() revalidates the workspace routes; there is no Next request
   store in this graph, and route invalidation is not what these tests are
   about. */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { listTicketSummariesAction, getTicketInboxConversationAction, addTicketToInboxAction } = await import(
  "../app/actions/tickets"
);

function contextWith(canView: boolean, services: Record<string, unknown> = {}, canEdit = false) {
  return {
    actor: { profileId: "staff-1", roleName: "staff" },
    user: { tickets: { view: canView, edit: canEdit } },
    services: { tickets: services },
  };
}

describe("listTicketSummariesAction", () => {
  it("refuses without tickets.view, never calling the repository", async () => {
    const list = vi.fn();
    getInternalContext.mockResolvedValue(contextWith(false, { list }));

    const result = await listTicketSummariesAction();

    expect(result.ok).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it("reads the Inbox-only summaries list, not the full Ticket list and not a transcript", async () => {
    const summaries = [
      { ticket_id: "legacy", inbox_added_at: "2026-09-18T09:00:00Z", personal_inbox_added_at: null },
      { ticket_id: "personal", inbox_added_at: "2026-11-04T00:00:00Z", personal_inbox_added_at: "2026-11-04T00:00:00Z" },
    ];
    const listInbox = vi.fn().mockResolvedValue(summaries);
    const list = vi.fn();
    const get = vi.fn();
    getInternalContext.mockResolvedValue(contextWith(true, { listInbox, list, get }));

    const result = await listTicketSummariesAction();

    expect(result).toEqual({ ok: true, data: summaries });
    expect(listInbox).toHaveBeenCalledTimes(1);
    // Tickets that were never added to the Inbox must not reach the pane,
    // which is a property of which read is called, not of a later filter.
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("getTicketInboxConversationAction", () => {
  it("refuses without tickets.view, never calling the repository", async () => {
    const get = vi.fn();
    getInternalContext.mockResolvedValue(contextWith(false, { get }));

    const result = await getTicketInboxConversationAction("t1");

    expect(result.ok).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("reads the one requested Ticket's detail", async () => {
    const detail = { ticket: { id: "t1" }, messages: [] };
    const get = vi.fn().mockResolvedValue(detail);
    getInternalContext.mockResolvedValue(contextWith(true, { get }));

    const result = await getTicketInboxConversationAction("t1");

    expect(result).toEqual({ ok: true, data: detail });
    expect(get).toHaveBeenCalledWith("t1");
  });
});


describe("addTicketToInboxAction", () => {
  it("refuses without tickets.edit, never calling the repository", async () => {
    const addToInbox = vi.fn();
    getInternalContext.mockResolvedValue(contextWith(true, { addToInbox }, false));

    const result = await addTicketToInboxAction("t1");

    expect(result.ok).toBe(false);
    expect(addToInbox).not.toHaveBeenCalled();
  });

  it("delegates to the one canonical membership mutation and copies nothing itself", async () => {
    const addToInbox = vi.fn().mockResolvedValue({ id: "t1" });
    const reply = vi.fn();
    const addInternalNote = vi.fn();
    getInternalContext.mockResolvedValue(
      contextWith(true, { addToInbox, reply, addInternalNote }, true),
    );

    const result = await addTicketToInboxAction("t1");

    expect(result).toEqual({ ok: true });
    expect(addToInbox).toHaveBeenCalledTimes(1);
    expect(addToInbox).toHaveBeenCalledWith("t1", expect.anything());
    // Making a Ticket available in the Inbox is not a way to write to its
    // conversation: no message, no note, no second conversation record.
    expect(reply).not.toHaveBeenCalled();
    expect(addInternalNote).not.toHaveBeenCalled();
  });

  it("surfaces the database refusal rather than reporting success", async () => {
    const addToInbox = vi.fn().mockRejectedValue(new Error("permission denied"));
    getInternalContext.mockResolvedValue(contextWith(true, { addToInbox }, true));

    const result = await addTicketToInboxAction("t1");

    expect(result.ok).toBe(false);
  });
});

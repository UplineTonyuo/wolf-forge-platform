import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, PermissionDeniedError } from "../lib/errors/application-error";
import { ticketConversationFingerprint } from "../domain/tickets/live-scheduler";

const mocks = vi.hoisted(() => ({ getContext: vi.fn(), getTicket: vi.fn(), getProject: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getTicketActorContext: mocks.getContext }));
vi.mock("../lib/supabase/identity-failure-response", () => ({
  identityFailureResponse: () => new Response(null, { status: 401 }),
}));
const { POST } = await import("../app/api/ticket-live/route");
const ID = "10000000-0000-4000-8000-000000000001";
const messages = [{ id: "message-1", body: "Synthetic Studio message", attachments: [], reactions: [] }];

function request(body: unknown, origin = "http://localhost:3046") {
  return new Request("http://localhost:3046/api/ticket-live", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost:3046", origin },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getContext.mockResolvedValue({ tickets: { get: mocks.getTicket, getForOrder: mocks.getProject } });
  mocks.getTicket.mockResolvedValue({ messages });
  mocks.getProject.mockResolvedValue({ messages });
});

describe("shared conversation live route", () => {
  it("retains the Ticket branch and returns only its Ticket identifier", async () => {
    const response = await POST(request({ ticket_id: ID, fingerprint: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: {
      ticketId: ID, fingerprint: ticketConversationFingerprint(messages), changed: true, messages,
    } });
    expect(mocks.getTicket).toHaveBeenCalledWith(ID);
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("uses the canonical Project conversation boundary and returns no Ticket identifier", async () => {
    const response = await POST(request({ order_id: ID, fingerprint: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: {
      orderId: ID, fingerprint: ticketConversationFingerprint(messages), changed: true, messages,
    } });
    expect(mocks.getProject).toHaveBeenCalledWith(ID);
    expect(mocks.getTicket).not.toHaveBeenCalled();
  });

  it("returns no transcript when the Project fingerprint is unchanged", async () => {
    const response = await POST(request({ order_id: ID, fingerprint: ticketConversationFingerprint(messages) }));
    expect((await response.json()).data).toMatchObject({ orderId: ID, changed: false, messages: null });
  });

  it.each([
    { order_id: ID, ticket_id: ID, fingerprint: null },
    { fingerprint: null },
    { order_id: ID, fingerprint: "x".repeat(20_001) },
    { order_id: ID, fingerprint: null, actorId: ID },
  ])("rejects mixed, missing, oversized or identity-bearing targets before resolving a session", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.getContext).not.toHaveBeenCalled();
    expect(mocks.getTicket).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests before session/database work", async () => {
    expect((await POST(request({ order_id: ID, fingerprint: null }, "https://other.invalid"))).status).toBe(403);
    expect(mocks.getContext).not.toHaveBeenCalled();
  });

  it("refuses a missing session before querying either resource", async () => {
    mocks.getContext.mockResolvedValue(null);
    expect((await POST(request({ order_id: ID, fingerprint: null }))).status).toBe(401);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.getTicket).not.toHaveBeenCalled();
  });

  it.each([new PermissionDeniedError(), new NotFoundError("Project")])("returns no data after the canonical Project boundary denies access", async (error) => {
    mocks.getProject.mockRejectedValue(error);
    const response = await POST(request({ order_id: ID, fingerprint: null }));
    expect([403, 404]).toContain(response.status);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: false }));
    expect(mocks.getTicket).not.toHaveBeenCalled();
  });

  it("fails closed when no Project conversation is returned", async () => {
    mocks.getProject.mockResolvedValue(null);
    const response = await POST(request({ order_id: ID, fingerprint: null }));
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("data");
  });
});

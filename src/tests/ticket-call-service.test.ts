import { beforeEach, describe, expect, it, vi } from "vitest";
import { callMutation, incomingCallPush } from "../domain/tickets/calls";
import { endTicketCall, joinTicketCall, mutateTicketCall, readTicketCalls } from "../services/ticket-call-service";
const id = "71000000-0000-4000-8000-000000000001";
const rpc = vi.fn();
const client = { rpc } as unknown as Parameters<typeof mutateTicketCall>[0];
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: { ended: true }, error: null }); });
describe("invitation service", () => {
  it("keeps the old media entry point disabled", async () => {
    await expect(joinTicketCall()).rejects.toThrow("disabled in Phase 1");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ends without reading provider flags or Ticket permissions", async () => {
    expect(await endTicketCall(client, id, id)).toEqual({ ended: true });
    expect(rpc).toHaveBeenCalledWith("app_ticket_call_command", { p_action: "end", p_call_id: id, p_device_id: undefined });
  });
  it("maps database authority refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private detail" } });
    await expect(endTicketCall(client, id, id)).rejects.toThrow();
  });
  it("does not let a request choose callee, room or account", () => {
    const input = { action: "request", request_id: id, ticket_id: id, device_id: id, mode: "audio" };
    expect(callMutation.safeParse(input).success).toBe(true);
    for (const key of ["callee_id", "room_url", "provider_account", "tenant_id"]) {
      expect(callMutation.safeParse({ ...input, [key]: id }).success).toBe(false);
    }
  });
  it("requires a device for acceptance and forbids browser setup/token commands", () => {
    expect(callMutation.safeParse({ action: "accept", call_id: id }).success).toBe(false);
    for (const action of ["setup", "join", "reserve"]) {
      expect(callMutation.safeParse({ action, call_id: id, device_id: id }).success).toBe(false);
    }
  });
  it("returns only the validated four owner numbers", async () => {
    rpc.mockResolvedValue({ data: { made: 4, answered: 2, missed: 1, connectedSeconds: 123 }, error: null });
    expect(await readTicketCalls(client, { action: "summary", month: "2026-10-01" })).toEqual({ made: 4, answered: 2, missed: 1, connectedSeconds: 123 });
    expect(rpc).toHaveBeenCalledWith("app_ticket_call_owner_summary", { p_month: "2026-10-01" });
  });
  it("reads the current actor's call without letting the browser choose an actor", async () => {
    const current = { enabled: false, profileId: id, accountClass: "client", call: null, peer: null, ticketId: null };
    rpc.mockResolvedValue({ data: current, error: null });
    expect(await readTicketCalls(client, { action: "current", ticket_id: id })).toEqual(current);
    expect(rpc).toHaveBeenCalledWith("app_ticket_call_current", { p_ticket_id: id, p_call_id: undefined });
    await expect(readTicketCalls(client, { action: "current", profile_id: id })).rejects.toThrow();
  });
  it("refuses malformed or over-broad current-call projections", async () => {
    rpc.mockResolvedValue({ data: { enabled: true, profileId: id, accountClass: "client", call: null, peer: null, ticketId: null, token: "not-media" }, error: null });
    await expect(readTicketCalls(client, { action: "current" })).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("requires a complete keyset cursor", async () => {
    await expect(readTicketCalls(client, { action: "history", ticket_id: id, before: "2026-10-01T00:00:00Z" })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps push generic and rejects Ticket/media details", () => {
    const payload = { title: "Incoming call from Wolf Forge", body: "Open Wolf Forge to answer.", callId: id, version: 1 };
    expect(incomingCallPush.safeParse(payload).success).toBe(true);
    for (const key of ["ticketId", "clientName", "token", "roomUrl"]) expect(incomingCallPush.safeParse({ ...payload, [key]: id }).success).toBe(false);
  });
});

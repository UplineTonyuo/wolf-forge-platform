import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ provider: vi.fn(), user: vi.fn(), trusted: vi.fn(), verify: vi.fn() }));
vi.mock("../lib/daily/calls", () => ({
  readDailyCallConfig: () => ({ key: "test-only", origin: "https://wolfforge.daily.co" }),
  callRoomProperties: (exp: number) => ({ exp }), dailyRequest: f.provider, verifiedCallRoom: f.verify,
}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({ rpc: f.trusted }) }));
const { joinTicketCall, endTicketCall } = await import("../services/ticket-call-service");
const id = "70000000-0000-4000-8000-000000000001";
const ticket = "70000000-0000-4000-8000-000000000002";
const actor = "70000000-0000-4000-8000-000000000003";
const call = (created = true) => ({ id, mode: "audio", state: "reserved", created, endClaim: true, participantIds: [actor],
  roomName: `wf-call-${id}`, expiresAt: new Date(Date.now() + 850000).toISOString() });
const client = { rpc: f.user } as unknown as Parameters<typeof joinTicketCall>[0];
beforeEach(() => {
  vi.resetAllMocks(); f.user.mockResolvedValue({ data: call(), error: null });
  f.trusted.mockResolvedValue({ data: null, error: null }); f.verify.mockReturnValue(true);
  f.provider.mockImplementation((_key, endpoint) => endpoint === "meeting-tokens" ? { token: "aaa.bbb.ccc" } : {});
});
describe("call provider mutation boundary", () => {
  it("reserves before creating, verifies before finalizing, and claims a token before issuance", async () => {
    const result = await joinTicketCall(client, actor, ticket, { requestId: id, mode: "audio" });
    expect(result.mode).toBe("audio");
    expect(f.user.mock.invocationCallOrder[0]).toBeLessThan(f.provider.mock.invocationCallOrder[0]!);
    expect(f.trusted).toHaveBeenCalledWith("app_complete_ticket_call_setup", { p_call_id: id });
    expect(f.provider).toHaveBeenLastCalledWith("test-only", "meeting-tokens", "POST", expect.objectContaining({ properties: expect.objectContaining({
      room_name: `wf-call-${id}`, user_id: actor, is_owner: false, eject_at_token_exp: true,
      permissions: { hasPresence: true, canSend: ["audio"], canAdmin: false },
    }) }));
    expect(f.user.mock.invocationCallOrder[1]).toBeLessThan(f.provider.mock.invocationCallOrder.at(-1)!);
  });
  it("does no provider work when authorization refuses", async () => {
    f.user.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(joinTicketCall(client, actor, ticket, { requestId: id, mode: "audio" })).rejects.toThrow();
    expect(f.provider).not.toHaveBeenCalled();
  });
  it("reconciles an uncertain creation but never repeats it on retry", async () => {
    f.provider.mockRejectedValueOnce(new Error("uncertain"));
    await joinTicketCall(client, actor, ticket, { requestId: id, mode: "audio" });
    f.provider.mockClear(); f.user.mockResolvedValue({ data: call(false), error: null });
    await joinTicketCall(client, actor, ticket, { requestId: id, mode: "audio" });
    expect(f.provider.mock.calls.some(c => c[1] === "rooms" && c[2] === "POST")).toBe(false);
  });
  it("refuses an unexpected room before minting a token", async () => {
    f.verify.mockReturnValue(false);
    await expect(joinTicketCall(client, actor, ticket, { requestId: id, mode: "audio" })).rejects.toThrow();
    expect(f.trusted).not.toHaveBeenCalled();
    expect(f.provider.mock.calls.some(c => c[1] === "meeting-tokens")).toBe(false);
  });
  it("does not reissue an uncertain end mutation", async () => {
    f.user.mockResolvedValue({ data: { ...call(false), state: "ended", endClaim: false }, error: null });
    expect(await endTicketCall(client, ticket, id)).toEqual({ ended: true, roomDeleted: false });
    expect(f.provider).not.toHaveBeenCalled();
  });
});

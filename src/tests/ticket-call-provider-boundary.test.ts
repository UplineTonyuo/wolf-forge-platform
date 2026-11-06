import { beforeEach, expect, it, vi } from "vitest";
import { callRoomProperties } from "../lib/daily/calls";
import { ingestTicketCallEvidence, prepareTicketCallMedia, reconcileTicketCallAccount, reconcileTicketCallCleanup } from "../services/ticket-call-provider";
const id = "71000000-0000-4000-8000-000000000001";
const actor = "71000000-0000-4000-8000-000000000002";
const claim = () => ({ id, roomName: `wf-call-${id}`, claimId: actor, mode: "audio", created: true, expiresAt: new Date(Date.now() + 850000).toISOString() });
const user = { rpc: vi.fn() }; const trusted = { rpc: vi.fn() };
const provider = { createRoom: vi.fn(), readRoom: vi.fn(), createToken: vi.fn(), ejectRoom: vi.fn(), deleteRoom: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); const reserved = claim();
  user.rpc.mockImplementation((_name, args) => Promise.resolve({ error: null, data: args.p_action === "setup" ? reserved
    : args.p_action === "join" ? { ...reserved, participantId: actor } : { state: "connecting" } }));
  trusted.rpc.mockResolvedValue({ data: true, error: null });
  provider.readRoom.mockResolvedValue({ name: reserved.roomName, url: `https://wolfforge.daily.co/${reserved.roomName}`,
    privacy: "private", config: callRoomProperties(Math.floor(Date.parse(reserved.expiresAt) / 1000)) });
  provider.createToken.mockResolvedValue({ token: "aaa.bbb.ccc" });
});
it("authorizes durable claims before creation and token issuance", async () => {
  expect((await prepareTicketCallMedia(user, trusted, provider, id, actor)).token).toBe("aaa.bbb.ccc");
  expect(user.rpc.mock.invocationCallOrder[0]).toBeLessThan(provider.createRoom.mock.invocationCallOrder[0]!);
  expect(user.rpc.mock.invocationCallOrder[1]).toBeLessThan(provider.createToken.mock.invocationCallOrder[0]!);
  expect(provider.createToken).toHaveBeenCalledWith(expect.objectContaining({ user_id: actor, is_owner: false,
    permissions: { hasPresence: true, canSend: ["audio"], canAdmin: false } }));
});
it("does no provider work when admission is refused", async () => {
  user.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
  await expect(prepareTicketCallMedia(user, trusted, provider, id, actor)).rejects.toThrow();
  expect(provider.readRoom).not.toHaveBeenCalled(); expect(provider.createRoom).not.toHaveBeenCalled();
});
it("does no room lookup or completion for a ready room when join is exhausted", async () => {
  user.rpc.mockImplementation((_name, args) => Promise.resolve(args.p_action === "setup"
    ? { data: { ...claim(), created: false, ready: true }, error: null }
    : { data: null, error: { code: "42501", message: "Call unavailable" } }));
  await expect(prepareTicketCallMedia(user, trusted, provider, id, actor)).rejects.toThrow();
  expect(provider.readRoom).not.toHaveBeenCalled();
  expect(provider.createRoom).not.toHaveBeenCalled();
  expect(provider.createToken).not.toHaveBeenCalled();
  expect(trusted.rpc).not.toHaveBeenCalled();
});
it("joins a durably verified ready room without repeating room verification", async () => {
  const reserved = { ...claim(), created: false, ready: true };
  user.rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "setup" ? reserved
    : args.p_action === "join" ? { ...reserved, participantId: actor } : { state: "connecting" }, error: null }));
  expect((await prepareTicketCallMedia(user, trusted, provider, id, actor)).token).toBe("aaa.bbb.ccc");
  expect(provider.readRoom).not.toHaveBeenCalled();
  expect(trusted.rpc).not.toHaveBeenCalled();
});
it("throttled setup retries never reach a provider, including claimed rooms", async () => {
  user.rpc.mockResolvedValue({ data: null, error: { code: "WF429", message: "rate limit exceeded" } });
  for (let n = 0; n < 20; n++) await expect(prepareTicketCallMedia(user, trusted, provider, id, actor)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(provider.readRoom).not.toHaveBeenCalled();
  expect(provider.createRoom).not.toHaveBeenCalled();
  expect(provider.createToken).not.toHaveBeenCalled();
});
it("reconciles creation uncertainty without a second POST", async () => {
  provider.createRoom.mockRejectedValue(new Error("uncertain"));
  await prepareTicketCallMedia(user, trusted, provider, id, actor);
  expect(provider.createRoom).toHaveBeenCalledTimes(1);
  expect(provider.readRoom).toHaveBeenCalledTimes(1);
});
it("rejects an unsafe provider room before token issuance", async () => {
  provider.readRoom.mockResolvedValue({ privacy: "public" });
  await expect(prepareTicketCallMedia(user, trusted, provider, id, actor)).rejects.toThrow();
  expect(provider.createToken).not.toHaveBeenCalled();
});
it("does not return a token after concurrent termination", async () => {
  const original = user.rpc.getMockImplementation()!;
  user.rpc.mockImplementation((name, args) => args.p_action === "status" ? Promise.resolve({ data: { state: "ended" }, error: null }) : original(name, args));
  await expect(prepareTicketCallMedia(user, trusted, provider, id, actor)).rejects.toThrow();
});
it("cleanup has no enabled flag dependency and reconciles unknown writes without resend", async () => {
  trusted.rpc.mockResolvedValueOnce({ data: [{ id, claimId: actor, roomName: `wf-call-${id}`, reconcileOnly: true }], error: null });
  expect(await reconcileTicketCallCleanup(trusted, provider)).toEqual({ absent: 0 });
  expect(provider.ejectRoom).not.toHaveBeenCalled(); expect(provider.deleteRoom).not.toHaveBeenCalled();
  expect(trusted.rpc).toHaveBeenLastCalledWith("app_finish_ticket_call_cleanup", { p_call_id: id, p_claim_id: actor, p_verified: false });
});
it("requires a persisted cleanup receipt even after room absence", async () => {
  provider.readRoom.mockResolvedValue(null);
  trusted.rpc.mockResolvedValueOnce({ data: [{ id, claimId: actor, roomName: `wf-call-${id}`, reconcileOnly: true }], error: null })
    .mockResolvedValueOnce({ data: false, error: null });
  await expect(reconcileTicketCallCleanup(trusted, provider)).rejects.toThrow("receipt");
});
it("validates bounded trusted evidence before the database", async () => {
  await expect(ingestTicketCallEvidence(trusted, { account: "other" })).rejects.toThrow();
  expect(trusted.rpc).not.toHaveBeenCalled();
});
it("manual calls keep short-lived join tokens without active-media ejection",async()=>{
 const reserved={...claim(),durationPolicy:"manual",expiresAt:new Date(Date.now()+120000).toISOString()};
 user.rpc.mockImplementation((_name,args)=>Promise.resolve({data:args.p_action==="setup"?reserved:args.p_action==="join"?{...reserved,participantId:actor}:{state:"active"},error:null}));
 provider.readRoom.mockResolvedValue({name:reserved.roomName,url:`https://wolfforge.daily.co/${reserved.roomName}`,privacy:"private",config:callRoomProperties(Math.floor(Date.parse(reserved.expiresAt)/1000),"manual")});
 await prepareTicketCallMedia(user,trusted,provider,id,actor);
 expect(provider.createToken).toHaveBeenCalledWith(expect.objectContaining({eject_at_token_exp:false,exp:Math.floor(Date.parse(reserved.expiresAt)/1000)}));
 expect(provider.createRoom.mock.calls[0]![1]).not.toHaveProperty("exp");
});
it("validates the account snapshot before trusted reconciliation", async () => {
  const snapshot = { account: "wolfforge", month: "2026-10-01", unmappedSeconds: 120, observedAt: "2026-10-29T00:00:00Z" };
  await expect(reconcileTicketCallAccount(trusted, { ...snapshot, unmappedSeconds: Infinity })).rejects.toThrow();
  await expect(reconcileTicketCallAccount(trusted, { ...snapshot, account: "other" })).rejects.toThrow();
  expect(trusted.rpc).not.toHaveBeenCalled();
  expect(await reconcileTicketCallAccount(trusted, snapshot)).toBe(true);
  expect(trusted.rpc).toHaveBeenCalledWith("app_reconcile_ticket_call_account", {
    p_account: "wolfforge", p_month: "2026-10-01", p_unmapped_seconds: 120, p_observed_at: "2026-10-29T00:00:00Z",
  });
});

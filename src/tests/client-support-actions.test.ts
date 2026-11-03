import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginClientSupportAction, endClientSupportAction } from "../app/actions/client-support";
import { CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE } from "../domain/auth/client-support";
const state = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[], set: vi.fn(), rpc: vi.fn(), internal: vi.fn(), server: vi.fn(), verified: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => state.cookies, set: state.set }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: state.internal, createNextServerSupabaseClient: state.server, getVerifiedSessionContext: state.verified }));
const id = "b1740000-0000-4000-8000-000000000090";
const target = "b1740000-0000-4000-8000-000000000002";
const activeCookie = () => ({ name: CLIENT_SUPPORT_COOKIE, value: `${id}.${"a".repeat(64)}` });
const result = (data: unknown, error: unknown = null) => ({ data, error });
beforeEach(() => {
  vi.resetAllMocks(); state.cookies = [];
  state.verified.mockResolvedValue({ actor: {} });
  state.server.mockResolvedValue({ rpc: state.rpc });
  state.internal.mockResolvedValue({ user: { role: "owner", clients: { privateManage: true } }, client: { rpc: state.rpc } });
});
describe("client support actions", () => {
  it("returns signed-out exit recovery to login without requiring an authenticated RPC", async () => {
    state.cookies = [{ name: CLIENT_SUPPORT_EXIT_COOKIE, value: id }];
    state.verified.mockResolvedValue(null);
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/login");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_COOKIE, "", expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true, sameSite: "strict" }));
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_EXIT_COOKIE, "", expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true, sameSite: "strict" }));
  });
  it("creates a separate bounded HttpOnly capability while retaining original Auth", async () => {
    state.rpc.mockResolvedValue(result({ id, expiresAt: new Date(Date.now() + 900000).toISOString() }));
    const data = new FormData(); data.set("client_profile_id", target);
    await expect(beginClientSupportAction({ error: null }, data)).rejects.toThrow("REDIRECT:/account");
    expect(state.rpc).toHaveBeenCalledWith("app_begin_client_support", { p_client_id: target, p_capability_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_COOKIE, expect.stringMatching(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/), expect.objectContaining({ httpOnly: true, sameSite: "strict", maxAge: 900, path: "/" }));
  });
  it.each([CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE])("blocks nesting with %s", async (name) => {
    state.cookies = [{ name, value: "pending" }]; const data = new FormData(); data.set("client_profile_id", target);
    expect((await beginClientSupportAction({ error: null }, data)).error).toMatch(/exiting/);
    expect(state.internal).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not create a session for a manager", async () => {
    state.internal.mockResolvedValue({ user: { role: "manager", clients: { privateManage: true } } });
    const data = new FormData(); data.set("client_profile_id", target);
    expect((await beginClientSupportAction({ error: null }, data)).error).toMatch(/owners and administrators/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("ends once and confirms server readback before reporting closure", async () => {
    state.cookies = [activeCookie()];
    state.rpc.mockResolvedValueOnce(result({ id, active: true })).mockResolvedValueOnce(result(null)).mockResolvedValueOnce(result({ id, active: false }));
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/clients");
    expect(state.server).toHaveBeenCalledWith({ support: false });
    expect(state.rpc.mock.calls.map((call) => call[0])).toEqual(["app_get_own_client_support_state", "app_end_client_support", "app_get_own_client_support_state"]);
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_EXIT_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
  });
  it("clears active delegation but preserves an Exit handle after unknown server state", async () => {
    state.cookies = [activeCookie()]; state.rpc.mockResolvedValue(result(null, { code: "unavailable" }));
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/client-support/exit?pending=1");
    expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
    expect(state.set).toHaveBeenCalledWith(CLIENT_SUPPORT_EXIT_COOKIE, id, expect.objectContaining({ httpOnly: true, maxAge: 900 }));
    expect(state.set).not.toHaveBeenCalledWith(CLIENT_SUPPORT_EXIT_COOKIE, "", expect.anything());
  });
  it("reconciles unknown End transport through confirmed inactive readback", async () => {
    state.cookies = [activeCookie()];
    state.rpc.mockResolvedValueOnce(result({ id, active: true })).mockResolvedValueOnce(result(null, { code: "unknown" })).mockResolvedValueOnce(result({ id, active: false }));
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/clients");
  });
  it("does not repeat End when a pending handle is already inactive", async () => {
    state.cookies = [{ name: CLIENT_SUPPORT_EXIT_COOKIE, value: id }]; state.rpc.mockResolvedValue(result({ id, active: false }));
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/clients"); expect(state.rpc).toHaveBeenCalledOnce();
  });
  it("recovers malformed cookies using the original session-bound latest lease", async () => {
    state.cookies = [{ name: CLIENT_SUPPORT_COOKIE, value: "broken" }]; state.rpc.mockResolvedValue(result(null));
    await expect(endClientSupportAction()).rejects.toThrow("REDIRECT:/clients");
    expect(state.rpc).toHaveBeenCalledWith("app_get_own_client_support_state", { p_support_id: null });
  });
});

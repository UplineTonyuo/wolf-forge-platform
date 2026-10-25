import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/internal/intake-maintenance/route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ list: mocks.list, remove: mocks.remove }) } }) }));
const id = "10000000-0000-4000-8000-000000000001";
const token = "x".repeat(32);
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET",token);
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "app_server_intake_maintenance"
    ? { reminders: 0, expired_drafts: 0, queued: [], expired_files: [{ id, path: `tenant/assignment/${id}` }] } : null }));
  mocks.remove.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request("http://localhost/api/internal/intake-maintenance", { headers: { authorization: `Bearer ${token}` } });

describe("private orphan cleanup", () => {
  it("checks existing Storage state before deletion and confirms absence before finishing", async () => {
    mocks.list.mockResolvedValueOnce({ data: [{ name: id }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([`tenant/assignment/${id}`]);
    expect(mocks.list.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_server_finish_expired_intake_file", { p_id: id });
  });
  it("reconciles an earlier successful deletion without deleting again", async () => {
    mocks.list.mockResolvedValue({ data: [], error: null });
    await GET(request());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_server_finish_expired_intake_file", { p_id: id });
  });
  it("does not delete or finalize when the current state cannot be read", async () => {
    mocks.list.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await GET(request());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

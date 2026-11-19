import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishPasswordRecovery, requestRecoveryCode } from "../app/actions/password-recovery";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
vi.mock("../lib/env/public-env", () => ({ readPublicEnvironment: () => ({}) }));
const eligibility = vi.hoisted(() => vi.fn());
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({ rpc: eligibility }) }));
vi.mock("../lib/security/login-protection", () => ({ beginProtectedLogin: async () => ({ ok: true }) }));

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    email: "person@example.test", code: "012345", password: "new-password", confirm: "new-password",
  })) data.set(key, value);
  return data;
}

describe("password recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    eligibility.mockResolvedValue({ data: true, error: null });
  });
  it("withholds code delivery and verification until activation is complete", async () => {
    eligibility.mockResolvedValue({ data: false, error: null });
    expect((await requestRecoveryCode(form())).ok).toBe(true);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect((await finishPasswordRecovery(form())).ok).toBe(false);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("gives the same receipt for a registered and an unknown email", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { status: 400 } });
    const receipt = await requestRecoveryCode(form());
    expect(receipt.ok).toBe(true);
    expect(await requestRecoveryCode(form())).toEqual(receipt);
  });
  it("checks password confirmation before consuming a code", async () => {
    const data = form();
    data.set("confirm", "different");
    expect((await finishPasswordRecovery(data)).ok).toBe(false);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("keeps an email cooldown indistinguishable from an accepted request", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({
      error: { status: 429, code: "over_email_send_rate_limit" },
    });
    const receipt = await requestRecoveryCode(form());
    expect(await requestRecoveryCode(form())).toEqual(receipt);
    expect(receipt.message).toMatch(/wait/i);
  });
  it("keeps the email step open when the provider throttles the request source", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, code: "over_request_rate_limit" } });
    expect(await requestRecoveryCode(form())).toMatchObject({ ok: false, message: expect.stringMatching(/wait/i) });
  });
  it("distinguishes an unavailable verifier from a rejected code", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { status: 503 }, data: { session: null } });
    expect(await finishPasswordRecovery(form())).toMatchObject({ ok: false, message: expect.stringMatching(/unavailable/i) });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("handles an uncertain password update without submitting it again", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null, data: { session: {} } });
    auth.updateUser.mockResolvedValue({ error: { status: 503 } });
    auth.signOut.mockResolvedValue({ error: null });
    expect(await finishPasswordRecovery(form())).toMatchObject({ ok: false, message: expect.stringMatching(/try signing in/i) });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });
  it("refuses a rejected code without changing credentials", async () => {
    auth.verifyOtp.mockResolvedValue({ error: {}, data: { session: null } });
    expect((await finishPasswordRecovery(form())).ok).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates the OTP-proven account and closes its sessions", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null, data: { session: {} } });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    expect((await finishPasswordRecovery(form())).ok).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", email: "person@example.test", token: "012345" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});

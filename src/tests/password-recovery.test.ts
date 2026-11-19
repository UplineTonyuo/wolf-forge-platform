import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishPasswordRecovery, requestRecoveryCode } from "../app/actions/password-recovery";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
vi.mock("../lib/env/public-env", () => ({ readPublicEnvironment: () => ({}) }));
vi.mock("../lib/security/login-protection", () => ({ beginProtectedLogin: async () => ({ ok: true }) }));

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    email: "person@example.test", code: "012345", password: "new-password", confirm: "new-password",
  })) data.set(key, value);
  return data;
}

describe("password recovery", () => {
  beforeEach(() => vi.resetAllMocks());
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeMyPasswordAction } from "../app/actions/security";
import { initialPasswordActionState } from "../domain/profile/security";
import type { SecurityAuditRow } from "../domain/security/audit";
import { setSecurityAuditSink } from "../lib/security/security-audit-log";
import { setSecurityLogSink, type SecurityLogRecord } from "../lib/security/security-log";

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn() }));
const actorId = "a1a2a3a4-b1b2-4c1c-8d1d-e1e2e3e4e5e6";

vi.mock("../lib/supabase/next-server", () => ({
  getSelfServiceContext: async () => ({
    actor: { id: "a1a2a3a4-b1b2-4c1c-8d1d-e1e2e3e4e5e6" },
    services: { profile: { getMine: async () => ({ email: "account@example.invalid" }) } },
  }),
  createNextServerSupabaseClient: async () => ({ auth }),
}));
vi.mock("../lib/supabase/client-support", () => ({ clientSupportRequested: async () => false }));
vi.mock("../lib/security/request-correlation", () => ({
  currentCorrelationId: async () => "0123456789abcdef0123456789abcdef",
}));

const rows: SecurityAuditRow[] = [];
const logs: SecurityLogRecord[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  rows.length = 0;
  logs.length = 0;
  auth.updateUser.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  setSecurityAuditSink(async (row) => { rows.push(row); });
  setSecurityLogSink((record) => { logs.push(record); });
});

afterEach(() => {
  setSecurityAuditSink(null);
  setSecurityLogSink(null);
});

function passwordForm(): FormData {
  const form = new FormData();
  form.set("current_password", "old-secret");
  form.set("new_password", "new-secret");
  form.set("confirm_password", "new-secret");
  return form;
}

describe("password-change revocation reporting", () => {
  it.each(["returned error", "thrown error"])("keeps the password change and warns when revocation has a %s", async (failure) => {
    if (failure === "returned error") auth.signOut.mockResolvedValue({ error: { code: "unexpected_failure" } });
    else auth.signOut.mockRejectedValue(new Error("Auth unavailable"));

    const result = await changeMyPasswordAction(initialPasswordActionState, passwordForm());

    expect(result).toMatchObject({
      error: null,
      changedAt: expect.any(String),
      warning: expect.stringMatching(/password.*changed.*sign.*out.*could not be confirmed/i),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_code: "auth.password.changed",
      actor_profile_id: actorId,
      outcome: "succeeded",
      metadata: { action: "auth.change_password", other_logins_revoked: false },
    });
    expect(logs.filter((record) => record.event === "auth.password.changed")).toHaveLength(1);
    expect(JSON.stringify({ rows, logs })).not.toMatch(/old-secret|new-secret|Auth unavailable/);
  });

  it("records confirmed revocation and returns ordinary success", async () => {
    const result = await changeMyPasswordAction(initialPasswordActionState, passwordForm());

    expect(result.error).toBeNull();
    expect(result.changedAt).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("warning", expect.any(String));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ action: "auth.change_password", other_logins_revoked: true });
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("does not revoke or record a changed password after Auth rejects the update", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: { code: "bad_password" } });

    const result = await changeMyPasswordAction(initialPasswordActionState, passwordForm());

    expect(result.changedAt).toBeNull();
    expect(result.fieldErrors.current_password).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

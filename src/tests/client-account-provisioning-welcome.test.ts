import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provisionClientAccount: vi.fn(),
  canSend: vi.fn(),
  send: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("../lib/security/server-cost-limit", () => ({ enforceServerCostLimit: async () => undefined }));
vi.mock("../lib/supabase/next-server", () => ({
  getAccountProvisioningService: async () => ({
    context: { actor: { id: "actor-1" }, client: { rpc: async () => ({ data: true, error: null }) } },
    provisioning: { provisionClientAccount: mocks.provisionClientAccount },
  }),
  requestTenantSelector: async () => "f0f0f0f0-0000-4000-8000-000000000001",
}));
vi.mock("../lib/email/client-welcome-email-server", () => ({
  canSendClientWelcomeEmail: mocks.canSend,
  createClientWelcomeEmailDependencies: () => ({}),
  sendClientWelcomeEmail: mocks.send,
}));

const { provisionClientAccountAction } = await import("../app/actions/client-account-provisioning");

function submit(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ email: "jane@acme.test", company: "Acme", ...fields })) {
    form.set(key, value);
  }
  return provisionClientAccountAction({ error: null, fieldErrors: {} }, form);
}

beforeEach(() => {
  mocks.provisionClientAccount.mockReset().mockResolvedValue({ companyId: "company-1", profile: { id: "profile-1" } });
  mocks.canSend.mockReset().mockResolvedValue(true);
  mocks.send.mockReset().mockResolvedValue("sent");
});

describe("Add Client welcome email option", () => {
  it("still requires a temporary password when the option is off", async () => {
    expect((await submit({})).fieldErrors.password).toBe("Create a temporary password.");
    expect(mocks.provisionClientAccount).not.toHaveBeenCalled();
  });

  it("keeps the temporary-password path unchanged when the option is off: no email, no welcome flag", async () => {
    await expect(submit({ temporary_password: "Temp-pass-123", confirm_password: "Temp-pass-123" })).rejects.toMatchObject({
      url: "/clients/company-1?created=1&portal=1",
    });
    expect(mocks.provisionClientAccount.mock.calls[0]?.[0]).toMatchObject({ temporary_password: "Temp-pass-123" });
    expect(mocks.canSend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses the option before creating a login when this sender cannot email", async () => {
    mocks.canSend.mockResolvedValue(false);

    expect((await submit({ send_welcome_email: "on" })).error).toMatch(/connected Gmail account/u);
    expect(mocks.provisionClientAccount).not.toHaveBeenCalled();
  });

  it("creates the login with no password, then sends the set-password email", async () => {
    await expect(submit({ send_welcome_email: "on", temporary_password: "ignored-pass" })).rejects.toMatchObject({
      url: "/clients/company-1?created=1&portal=1&welcome=sent",
    });
    expect(mocks.provisionClientAccount.mock.calls[0]?.[0]).toMatchObject({ temporary_password: undefined });
    expect(mocks.send).toHaveBeenCalledWith("profile-1", expect.any(String), {});
  });

  it("stores the Business name on a new Client record and never links a Company", async () => {
    await expect(submit({
      company: "Anthony PLATFORM",
      company_id: "20000000-0000-4000-8000-000000000002",
      temporary_password: "Temp-pass-123",
      confirm_password: "Temp-pass-123",
    })).rejects.toMatchObject({ url: "/clients/company-1?created=1&portal=1" });

    const input = mocks.provisionClientAccount.mock.calls[0]?.[0];
    expect(input).toMatchObject({ company_name: "Anthony PLATFORM" });
    expect(input).not.toHaveProperty("company_id");
  });

  it("requires a Business name", async () => {
    const state = await submit({ company: "", temporary_password: "Temp-pass-123", confirm_password: "Temp-pass-123" });
    expect(state.fieldErrors.company).toBe("Enter a business name.");
    expect(mocks.provisionClientAccount).not.toHaveBeenCalled();
  });

  it("keeps the account and reports the email as failed when the send breaks", async () => {
    mocks.send.mockRejectedValue(new Error("gmail down"));

    await expect(submit({ send_welcome_email: "on" })).rejects.toMatchObject({
      url: "/clients/company-1?created=1&portal=1&welcome=failed",
    });
  });
});

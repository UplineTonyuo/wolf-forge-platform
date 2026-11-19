import { describe, expect, it, vi } from "vitest";
import { contactEmailSchema } from "../domain/contacts/email-schema";
import { sendClientContactEmail, type ContactEmailDependencies } from "../lib/email/client-contact-email";
import { sendClientContactEmailAction } from "../app/actions/client-contact-email";
import { loadInvoiceEmailTargetAction } from "../app/actions/invoice-manual-payments";
import { canSendClientWelcomeEmail } from "../lib/email/client-welcome-email-server";
import { getInternalContext } from "../lib/supabase/next-server";

const mail = vi.hoisted(() => ({
  issuer: vi.fn(), trustedRpc: vi.fn(), send: vi.fn(), context: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: mail.context, requestTenantSelector: async () => "tenant",
}));
vi.mock("../lib/integrations/gmail-server", () => ({
  isGmailIntegrationConfigured: () => true,
  createGmailIntegrationService: () => ({ send: mail.send }),
}));
vi.mock("../lib/supabase/trusted-server-client", () => ({
  createTrustedServerSupabaseClient: () => ({ rpc: mail.trustedRpc }),
}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));

const input = { requestId: "10000000-0000-4000-8000-000000000001", contactId: "20000000-0000-4000-8000-000000000001", recipientEmail: "synthetic@example.test", subject: "Test", body: "Synthetic QA" };
function dependencies(): ContactEmailDependencies {
  return { claim: vi.fn(async () => ({ outcome: "claimed" as const, recipient: "synthetic@example.test" })), send: vi.fn(async () => "provider-id"), finish: vi.fn(async () => {}) };
}
describe("client contact email", () => {
  it("allows contact and invoice email when a non-owner cannot issue activation links", async () => {
    mail.context.mockResolvedValue({
      user: { role: "admin", clients: { privateManage: true }, integrations: { manage: true } },
      actor: { id: "actor" },
      client: { rpc: mail.issuer },
      services: {
        integrations: { listConnections: async () => [{ provider: { id: "gmail" }, status: "connected" }] },
        invoices: { get: async () => ({ invoice: { company_id: "company" } }) },
        contacts: { listForCompany: async () => [{ id: input.contactId, email: input.recipientEmail, is_primary: true }] },
      },
    });
    mail.issuer.mockResolvedValue({ data: false, error: null });
    mail.trustedRpc.mockResolvedValueOnce({ data: { outcome: "claimed", recipient: input.recipientEmail } })
      .mockResolvedValueOnce({ error: null });
    mail.send.mockResolvedValue("provider-id");

    expect(await loadInvoiceEmailTargetAction("invoice")).toMatchObject({ ok: true, data: { available: true } });
    expect(await sendClientContactEmailAction(input)).toMatchObject({ ok: true, locked: true });
    expect(mail.send).toHaveBeenCalledExactlyOnceWith({ to: input.recipientEmail, subject: input.subject, text: input.body });
    expect(mail.issuer).not.toHaveBeenCalled();

    const context = await getInternalContext();
    expect(await canSendClientWelcomeEmail(context)).toBe(false);
    expect(mail.issuer).toHaveBeenCalledExactlyOnceWith("app_can_issue_client_invitation");
    mail.issuer.mockResolvedValueOnce({ data: true, error: null });
    expect(await canSendClientWelcomeEmail(context)).toBe(true);
    mail.issuer.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await canSendClientWelcomeEmail(context)).toBe(false);
    mail.issuer.mockRejectedValueOnce(new Error("connection lost"));
    expect(await canSendClientWelcomeEmail(context)).toBe(false);
  });
  it("does not send if the contact address changed after the composer opened", async () => {
    const deps = dependencies();
    vi.mocked(deps.claim).mockResolvedValue({ outcome: "claimed", recipient: "different@example.test" });
    await expect(sendClientContactEmail(input, deps)).resolves.toBe("recipient_changed");
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("records an attempt before sending to the server-resolved recipient", async () => {
    const deps = dependencies();
    await expect(sendClientContactEmail(input, deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledWith({ to: "synthetic@example.test", subject: "Test", text: "Synthetic QA" });
    expect(deps.finish).toHaveBeenCalledWith(input.requestId, "provider-id");
    expect(vi.mocked(deps.claim).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.send).mock.invocationCallOrder[0]!);
  });
  it.each(["accepted", "sending", "uncertain"] as const)("never resends a replayed %s attempt", async (outcome) => {
    const deps = dependencies(); vi.mocked(deps.claim).mockResolvedValue({ outcome });
    await expect(sendClientContactEmail(input, deps)).resolves.toBe(outcome);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("fails closed when recording the attempt fails", async () => {
    const deps = dependencies(); vi.mocked(deps.claim).mockRejectedValue(new Error("database unavailable"));
    await expect(sendClientContactEmail(input, deps)).rejects.toThrow();
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("records uncertainty after a provider timeout without retrying", async () => {
    const deps = dependencies(); vi.mocked(deps.send).mockRejectedValue(new Error("timeout"));
    await expect(sendClientContactEmail(input, deps)).resolves.toBe("uncertain");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.finish).toHaveBeenCalledWith(input.requestId, null);
  });
  it("keeps an accepted result when the final database write is unavailable", async () => {
    const deps = dependencies(); vi.mocked(deps.finish).mockRejectedValue(new Error("database unavailable"));
    await expect(sendClientContactEmail(input, deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("rejects header injection and empty messages", () => {
    expect(contactEmailSchema.safeParse({ ...input, subject: "Hello\r\nBcc: other@example.test" }).success).toBe(false);
    expect(contactEmailSchema.safeParse({ ...input, body: "   " }).success).toBe(false);
  });
});

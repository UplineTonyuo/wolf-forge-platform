import { describe, expect, it, vi } from "vitest";
import { contactEmailSchema } from "../domain/contacts/email-schema";
import { sendClientContactEmail, type ContactEmailDependencies } from "../lib/email/client-contact-email";

const input = { requestId: "10000000-0000-4000-8000-000000000001", contactId: "20000000-0000-4000-8000-000000000001", recipientEmail: "synthetic@example.test", subject: "Test", body: "Synthetic QA" };
function dependencies(): ContactEmailDependencies {
  return { claim: vi.fn(async () => ({ outcome: "claimed" as const, recipient: "synthetic@example.test" })), send: vi.fn(async () => "provider-id"), finish: vi.fn(async () => {}) };
}
describe("client contact email", () => {
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

import type { ContactEmailInput, ContactEmailOutcome } from "../../domain/contacts/email-schema";
import type { GmailMessage } from "../integrations/google-oauth-client";

export type ContactEmailDependencies = {
  claim(input: ContactEmailInput): Promise<{ outcome: "claimed"; recipient: string } | { outcome: ContactEmailOutcome }>;
  send(message: GmailMessage): Promise<string>;
  finish(requestId: string, providerMessageId: string | null): Promise<void>;
};

export async function sendClientContactEmail(input: ContactEmailInput, dependencies: ContactEmailDependencies): Promise<ContactEmailOutcome> {
  const claim = await dependencies.claim(input);
  if (claim.outcome !== "claimed") return claim.outcome;
  if (claim.recipient.trim().toLocaleLowerCase() !== input.recipientEmail.trim().toLocaleLowerCase()) {
    await dependencies.finish(input.requestId, null).catch(() => undefined);
    return "recipient_changed";
  }
  let providerId: string;
  try {
    providerId = await dependencies.send({ to: claim.recipient, subject: input.subject, text: input.body });
  } catch {
    // A lost response may follow acceptance; the same request must never send again.
    await dependencies.finish(input.requestId, null).catch(() => undefined);
    return "uncertain";
  }
  await dependencies.finish(input.requestId, providerId).catch(() => undefined);
  return "accepted";
}

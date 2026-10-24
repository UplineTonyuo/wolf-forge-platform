"use server";

import { z } from "zod";
import { contactEmailSchema } from "../../domain/contacts/email-schema";
import { sendClientContactEmail } from "../../lib/email/client-contact-email";
import { canSendClientWelcomeEmail } from "../../lib/email/client-welcome-email-server";
import { readServerEnvironment } from "../../lib/env/server-env";
import { toClientSafeError } from "../../lib/errors/application-error";
import { mapDatabaseError } from "../../lib/errors/map-database-error";
import { createGmailIntegrationService } from "../../lib/integrations/gmail-server";
import { getInternalContext, requestTenantSelector } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";

const claimSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("claimed"), recipient: z.email() }),
  z.object({ outcome: z.enum(["accepted", "sending", "uncertain"]) }),
]);

export async function sendClientContactEmailAction(raw: unknown) {
  try {
    const input = contactEmailSchema.parse(raw);
    const context = await getInternalContext();
    if (!(await canSendClientWelcomeEmail(context))) return { ok: false, message: "Connect Gmail in Settings → Integrations to send email." };
    const tenant = await requestTenantSelector();
    const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
    const gmail = createGmailIntegrationService(context.actor);
    const outcome = await sendClientContactEmail(input, {
      async claim(message) {
        const result = await trusted.rpc("app_server_claim_contact_email", {
          p_actor_id: context.actor.id, p_tenant_id: tenant, p_request_id: message.requestId,
          p_contact_id: message.contactId, p_subject: message.subject, p_body: message.body,
        });
        if (result.error) throw mapDatabaseError(result.error, "Email");
        return claimSchema.parse(result.data);
      },
      send: (message) => gmail.send(message),
      async finish(requestId, providerId) {
        const result = await trusted.rpc("app_server_finish_contact_email", {
          p_actor_id: context.actor.id, p_tenant_id: tenant, p_request_id: requestId,
          ...(providerId ? { p_provider_message_id: providerId } : {}),
        });
        if (result.error) throw mapDatabaseError(result.error, "Email");
      },
    });
    return { ok: outcome === "accepted", locked: true, message: outcome === "accepted"
      ? "Gmail accepted your email for sending." : outcome === "recipient_changed"
      ? "The contact’s email changed while you were composing. Close this draft and review the current address before sending."
      : "This email attempt is recorded. Check the connected Gmail Sent folder before sending it again." };
  } catch (error) {
    return { ok: false, message: toClientSafeError(error).message };
  }
}

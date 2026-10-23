"use server";

import { z } from "zod";
import { ACTIVATION_LINK_DAYS } from "../../lib/email/client-welcome-email";
import {
  canSendClientWelcomeEmail,
  createClientWelcomeEmailDependencies,
  sendClientWelcomeEmail,
  type ClientWelcomeEmailOutcome,
} from "../../lib/email/client-welcome-email-server";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { getInternalContext, requestTenantSelector } from "../../lib/supabase/next-server";

export type SendClientWelcomeEmailResult = { ok: boolean; message: string };

const messages: Record<ClientWelcomeEmailOutcome, string> = {
  sent: `Welcome email sent. The link works once and expires in ${ACTIVATION_LINK_DAYS} days.`,
  failed: "The welcome email was not sent. Check the Gmail connection in Settings > Integrations, then try again.",
  in_progress: "A welcome email is already being sent to this client.",
  recently_sent: "A welcome email was sent less than a minute ago.",
  activated: "This client has already set their password.",
  no_verified_host: "This workspace has no verified public web address yet, so welcome emails stay disabled.",
};

/**
 * Sends, or re-sends, the welcome email with a fresh set-password link. A
 * repeated `requestId` reports its first outcome instead of sending again.
 */
export async function sendClientWelcomeEmailAction(
  profileId: string,
  requestId: string,
): Promise<SendClientWelcomeEmailResult> {
  if (!z.uuid().safeParse(profileId).success || !z.uuid().safeParse(requestId).success) {
    return { ok: false, message: "This client portal account could not be found." };
  }

  const context = await getInternalContext();

  if (!(await canSendClientWelcomeEmail(context))) {
    return { ok: false, message: "Welcome emails need a connected Gmail account and integrations access." };
  }

  try {
    await enforceServerCostLimit({ actorId: context.actor.id, action: "account.provision" });
    const outcome = await sendClientWelcomeEmail(
      profileId,
      requestId,
      createClientWelcomeEmailDependencies(context.actor, await requestTenantSelector()),
    );
    return { ok: outcome === "sent", message: messages[outcome] };
  } catch (error) {
    return { ok: false, message: toClientSafeError(error).message };
  }
}

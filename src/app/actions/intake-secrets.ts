"use server";

import type { IntakeSecretCaptureInput } from "../../domain/forms/schema";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export async function captureIntakeSecret(input: IntakeSecretCaptureInput) {
  try {
    const context = await getClientContext();
    const reference = await context.services.forms.captureIntakeSecret(input, context.actor);
    return { ok: true as const, reference };
  } catch {
    return { ok: false as const, error: "The password could not be saved. Try again." };
  }
}

export async function listIntakeSecretReferences(submissionId: string) {
  try {
    const context = await getInternalContext();
    const references = await context.services.forms.listIntakeSecretReferences(submissionId);
    return { ok: true as const, references };
  } catch {
    return { ok: false as const, error: "Saved passwords are unavailable under your current access." };
  }
}

export async function revealIntakeSecret(credentialId: string) {
  try {
    const context = await getInternalContext();
    const secret = await context.services.forms.revealIntakeSecret(credentialId, context.actor);
    return { ok: true as const, secret };
  } catch {
    return { ok: false as const, error: "The password is unavailable under your current access." };
  }
}

import "server-only";

import { isGoogleOAuthConfigured, readGoogleOAuthEnvironment } from "../env/google-oauth-env";
import { readServerEnvironment } from "../env/server-env";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";
import type { VerifiedActor } from "../supabase/user-client";
import { GmailIntegrationService } from "../../services/gmail-integration-service";
import { GmailVaultCredentialStore } from "./gmail-credential-store";
import { GoogleOAuthClient } from "./google-oauth-client";

export function createGmailIntegrationService(actor: VerifiedActor): GmailIntegrationService {
  const googleEnvironment = readGoogleOAuthEnvironment();
  const trustedClient = createTrustedServerSupabaseClient(readServerEnvironment());
  return new GmailIntegrationService(
    new GoogleOAuthClient(googleEnvironment),
    new GmailVaultCredentialStore(trustedClient, actor),
  );
}

export function isGmailIntegrationConfigured(): boolean {
  if (!isGoogleOAuthConfigured()) return false;
  try {
    readServerEnvironment();
    return true;
  } catch {
    return false;
  }
}

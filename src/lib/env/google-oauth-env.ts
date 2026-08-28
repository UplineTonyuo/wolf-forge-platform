import "server-only";

import { z } from "zod";
import type { EnvironmentSource } from "./public-env";

export const GMAIL_OAUTH_CALLBACK_PATH = "/settings/integrations/gmail/callback";

const googleOAuthEnvironmentSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().trim().min(1),
  GOOGLE_CLIENT_SECRET: z.string().trim().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().trim().url(),
}).superRefine((environment, context) => {
  const redirect = new URL(environment.GOOGLE_OAUTH_REDIRECT_URI);
  const localHttp = redirect.protocol === "http:"
    && (redirect.hostname === "127.0.0.1" || redirect.hostname === "localhost")
    && process.env.NODE_ENV !== "production";

  if (redirect.protocol !== "https:" && !localHttp) {
    context.addIssue({ code: "custom", path: ["GOOGLE_OAUTH_REDIRECT_URI"], message: "OAuth redirect URI must use HTTPS outside local development." });
  }
  if (redirect.pathname !== GMAIL_OAUTH_CALLBACK_PATH || redirect.search || redirect.hash) {
    context.addIssue({ code: "custom", path: ["GOOGLE_OAUTH_REDIRECT_URI"], message: `OAuth redirect URI must end exactly at ${GMAIL_OAUTH_CALLBACK_PATH}.` });
  }
});

export type GoogleOAuthEnvironment = z.infer<typeof googleOAuthEnvironmentSchema>;

export function readGoogleOAuthEnvironment(source: EnvironmentSource = process.env): GoogleOAuthEnvironment {
  return googleOAuthEnvironmentSchema.parse(source);
}

export function isGoogleOAuthConfigured(source: EnvironmentSource = process.env): boolean {
  return googleOAuthEnvironmentSchema.safeParse(source).success;
}


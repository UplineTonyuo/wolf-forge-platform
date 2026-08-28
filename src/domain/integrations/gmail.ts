export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export type GmailOAuthScope = (typeof GMAIL_OAUTH_SCOPES)[number];

export function hasExactGmailScopes(scopes: readonly string[]): boolean {
  return scopes.length === GMAIL_OAUTH_SCOPES.length
    && GMAIL_OAUTH_SCOPES.every((scope) => scopes.includes(scope));
}


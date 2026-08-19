import { z } from "zod";

/**
 * Account security domain.
 *
 * Password values only ever pass through this module as opaque strings. Nothing
 * here reads, stores, hashes or logs a password, and no password value is ever
 * written to an application table — Supabase Auth owns the credential.
 */

/**
 * Mirrors `minimum_password_length` in supabase/config.toml.
 *
 * It is a server setting with no runtime accessor, so this constant exists to
 * give the user an accurate message before a round trip. Supabase Auth re-checks
 * it regardless, so this is UX rather than enforcement — if the project setting
 * is raised, Auth still rejects and the mapped error is surfaced.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      ),
    confirm_password: z.string().min(1, "Confirm your new password."),
  })
  .refine((value) => value.new_password === value.confirm_password, {
    path: ["confirm_password"],
    message: "The new passwords do not match.",
  })
  .refine((value) => value.new_password !== value.current_password, {
    path: ["new_password"],
    message: "Choose a password different from your current one.",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export type PasswordActionState = {
  error: string | null;
  fieldErrors: Record<string, string>;
  /** ISO timestamp of the last successful change, used to confirm in the UI. */
  changedAt: string | null;
};

export const initialPasswordActionState: PasswordActionState = {
  error: null,
  fieldErrors: {},
  changedAt: null,
};

/**
 * A sign-in identity as reported by Supabase Auth.
 *
 * Only identities Auth actually returns are ever rendered — nothing about this
 * shape is speculative or locally invented.
 */
export type SignInIdentity = {
  id: string;
  provider: string;
  email: string | null;
  /** True for the password identity, which cannot be removed. */
  isPrimary: boolean;
};

/** Human label for a provider key returned by Auth. */
export function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    email: "Email and password",
    google: "Google",
    azure: "Microsoft",
    apple: "Apple",
    github: "GitHub",
  };

  return labels[provider] ?? provider.replace(/^./u, (first) => first.toUpperCase());
}

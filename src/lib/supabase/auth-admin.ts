import { readServerEnvironment } from "../env/server-env";
import { createTrustedServerSupabaseClient, type TrustedServerClient } from "./trusted-server-client";

/**
 * Server-only Supabase Auth Admin boundary.
 *
 * Creating auth.users cannot happen inside Postgres, so this is the one place
 * the service-role key is used for account provisioning. The adapter exposes
 * only the operations provisioning and client activation need, never returns or logs the
 * password or the key, and refuses to construct itself in a browser bundle.
 * Everything that decides *access* stays in the database.
 */
export type CreatedAuthUser = {
  id: string;
  email: string | null;
};

export type AuthAdminFailure = {
  reason: "already_exists" | "weak_password" | "rejected";
  message: string;
};

export class AuthAdminError extends Error {
  constructor(readonly failure: AuthAdminFailure) {
    super(failure.message);
    this.name = "AuthAdminError";
  }
}

function isAlreadyRegistered(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already") ||
    normalized.includes("registered") ||
    normalized.includes("exists")
  );
}

export class AuthAdminAdapter {
  private constructor(private readonly trusted: TrustedServerClient) {}

  /** Throws when the server has no provisioning credentials configured. */
  static create(): AuthAdminAdapter {
    if (typeof window !== "undefined") {
      throw new Error("The auth admin boundary is server-only.");
    }
    return new AuthAdminAdapter(createTrustedServerSupabaseClient(readServerEnvironment()));
  }

  /** No password creates a login that can sign in only after the client sets one. */
  async createUser(input: {
    email: string;
    password?: string;
    displayName: string | null;
  }): Promise<CreatedAuthUser> {
    const { data, error } = await this.trusted.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName ?? input.email },
    });

    if (error || !data.user) {
      const message = error?.message ?? "The login could not be created.";
      throw new AuthAdminError({
        reason: isAlreadyRegistered(message) ? "already_exists" : "rejected",
        message,
      });
    }

    return { id: data.user.id, email: data.user.email ?? null };
  }

  /** Best-effort compensation when the database half of provisioning fails. */
  async deleteUser(userId: string): Promise<void> {
    await this.trusted.auth.admin.deleteUser(userId);
  }

  /** Client activation only: the caller has already verified a set-password link for this user. */
  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.trusted.auth.admin.updateUserById(userId, { password });
    if (error) {
      throw new AuthAdminError({
        reason: error.code === "weak_password" ? "weak_password" : "rejected",
        message: error.message,
      });
    }
  }
}

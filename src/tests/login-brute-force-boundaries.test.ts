import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIGN_IN_FAILURE_MESSAGE,
  SIGN_IN_UNASSIGNED_MESSAGE,
  isCredentialStageFailure,
  resolveSignInSurface,
  signInFailure,
  signInUnassigned,
} from "../domain/auth/login-flow";

/**
 * Login abuse boundaries (C1-3).
 *
 * This suite pins two things that are easy to lose and expensive to lose:
 *
 *   1. NON-ENUMERATION. Every credential-stage failure must be byte-identical.
 *      The moment "no such account" and "wrong password" differ, the login form
 *      becomes a free account-harvesting API — an attacker learns which of a
 *      leaked address list are real without guessing a single password.
 *
 *   2. The RATE-LIMIT POSTURE recorded in KI-022. Password throttling is
 *      provider-side (Supabase Auth's per-IP `sign_in_sign_ups` bucket) and
 *      there is deliberately no application-level limiter: an anon-callable
 *      limiter RPC would contradict Batch B2's rule that anon can EXECUTE
 *      nothing in `private`. These assertions exist so that decision is
 *      REVISITED rather than quietly reversed — if someone adds a counter here,
 *      this suite fails and points at the issue.
 */

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("login failure is non-enumerating", () => {
  it("returns one identical message for every credential-stage failure", () => {
    const causes = [
      new Error("Invalid login credentials"),
      new Error("Email not confirmed"),
      new Error("User not found"),
      { status: 429, message: "Request rate limit reached" },
      { status: 400, message: "Password should be at least 6 characters" },
      undefined,
      null,
    ];

    const messages = new Set(causes.map((cause) => signInFailure(cause).error));
    expect(messages.size).toBe(1);
    expect([...messages][0]).toBe(SIGN_IN_FAILURE_MESSAGE);
  });

  it("never echoes the provider's wording back to the browser", () => {
    // Supabase's own text distinguishes "Invalid login credentials" from
    // "Email not confirmed" — passing either through is the enumeration leak.
    const leaky = "Invalid login credentials for user@example.com";
    const response = signInFailure(new Error(leaky));

    expect(response.error).not.toContain("user@example.com");
    expect(response.error).not.toContain("Invalid login credentials");
    expect(response.error).not.toContain("confirmed");
    expect(response.error).not.toContain("rate limit");
  });

  it("says nothing about which half of the pair was wrong", () => {
    const message = SIGN_IN_FAILURE_MESSAGE.toLowerCase();

    for (const tell of ["no account", "not found", "unknown", "incorrect password", "wrong password", "does not exist"]) {
      expect(message).not.toContain(tell);
    }
    // It must name BOTH factors together, which is what makes it uninformative.
    expect(message).toContain("email and password");
  });

  it("treats a missing session as failure even when the provider reported none", () => {
    // A 200 with no session is not an authenticated caller. Trusting the
    // absence of an error here would let a degraded provider response through.
    expect(isCredentialStageFailure({ error: null, session: null })).toBe(true);
    expect(isCredentialStageFailure({ error: null, session: undefined })).toBe(true);
    expect(isCredentialStageFailure({ error: new Error("x"), session: { access_token: "t" } })).toBe(true);
    expect(isCredentialStageFailure({ error: null, session: { access_token: "t" } })).toBe(false);
  });
});

describe("the post-authentication refusal is a different, safe message", () => {
  it("distinguishes an unassigned account only after the password is proven", () => {
    // Reaching this branch requires having already authenticated, so it reveals
    // nothing to someone who does not hold the credential.
    expect(signInUnassigned().error).toBe(SIGN_IN_UNASSIGNED_MESSAGE);
    expect(SIGN_IN_UNASSIGNED_MESSAGE).not.toBe(SIGN_IN_FAILURE_MESSAGE);
  });

  it("routes a verified actor to exactly one surface, internal first", () => {
    expect(resolveSignInSurface({ hasInternalUser: true, hasClientUser: false })).toBe("internal");
    expect(resolveSignInSurface({ hasInternalUser: false, hasClientUser: true })).toBe("client");
    expect(resolveSignInSurface({ hasInternalUser: true, hasClientUser: true })).toBe("internal");
    expect(resolveSignInSurface({ hasInternalUser: false, hasClientUser: false })).toBeNull();
  });
});

describe("the sign-in action holds no second failure branch", () => {
  const action = read("app/actions/auth.ts");

  it("delegates every failure message to login-flow.ts", () => {
    expect(action).toContain('from "../../domain/auth/login-flow"');
    expect(action).toContain("signInFailure(error)");
    expect(action).toContain("signInUnassigned()");
  });

  it("carries no inline failure string that could drift apart from it", () => {
    // A literal here is how enumeration comes back: someone "improves" one
    // branch's wording and the two stop matching.
    expect(action).not.toContain("don't match an account");
    expect(action).not.toContain("No account");
    expect(action).not.toContain("password is incorrect");
  });

  it("does not branch on whether the email exists before authenticating", () => {
    // A pre-flight existence lookup reintroduces the oracle through timing even
    // if the message stays uniform.
    expect(action).not.toContain("listUsers");
    expect(action).not.toContain("getUserByEmail");
    expect(action).not.toMatch(/from\("profiles"\)[\s\S]{0,200}signInWithPassword/);
  });

  it("keeps the validated redirect target on both surfaces", () => {
    expect(action).toContain("safeNextPath(formData.get(\"next\"))");
    expect(action).toContain("safeAccountNextPath(formData.get(\"next\"))");
  });
});

describe("rate-limit posture is durable, multi-signal and lockout-safe", () => {
  const action = read("app/actions/auth.ts");
  const protection = read("lib/security/login-protection.ts");
  const migration = read(
    "../supabase/migrations/20260827094453_production_login_cost_abuse_hardening.sql",
  );

  it("checks invisible bot protection and the durable limiter before Auth", () => {
    expect(action.indexOf("beginProtectedLogin(email)")).toBeLessThan(
      action.indexOf("signInWithPassword"),
    );
    expect(protection).toContain("checkBotId()");
    expect(protection).toContain('rpc("app_login_rate_limit_preflight"');
    expect(protection).not.toContain("new Map(");
  });

  it("uses source, source+identity and failure-history signals", () => {
    expect(migration).toContain("auth.login.source.attempt.minute");
    expect(migration).toContain("auth.login.pair.failure.ten_minutes");
    expect(migration).toContain("auth.login.identity.failure.hour");
    expect(migration).toContain("app_record_login_failure");
  });

  it("never hard-blocks solely on the targeted identity", () => {
    const identityRisk = migration.slice(
      migration.indexOf("identity_targeted :="),
      migration.indexOf("return jsonb_build_object"),
    );
    expect(identityRisk).not.toContain("raise exception");
    expect(migration).toContain("is NEVER a hard denial");
  });

  it("keeps limiter RPCs off browser roles and fingerprints raw signals", () => {
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
    expect(protection).toContain('createHmac("sha256"');
    expect(protection).not.toContain("console.");
  });

  it("keeps sign-out global so a compromised session cannot outlive it", () => {
    expect(action).toContain("signOut()");
    expect(action).toContain('redirect("/login")');
  });
});

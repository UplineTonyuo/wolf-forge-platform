import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loginFingerprint,
  normalizeLoginIdentity,
  trustedLoginSource,
} from "../lib/security/login-protection";

describe("production login signal handling", () => {
  it("keeps ordinary login frictionless and protects only its POST", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/login/page.tsx"), "utf8");
    const instrumentation = readFileSync(
      resolve(import.meta.dirname, "../instrumentation-client.ts"),
      "utf8",
    );
    expect(page.toLowerCase()).not.toContain("captcha");
    expect(page.toLowerCase()).not.toContain("turnstile");
    expect(instrumentation).toContain('path: "/login", method: "POST"');
  });

  it("normalizes equivalent identities without retaining plaintext", () => {
    expect(normalizeLoginIdentity("  User@Example.COM  ")).toBe("user@example.com");
    const fingerprint = loginFingerprint("test-secret", "identity", "user@example.com");
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("user@example.com");
  });

  it("separates source and identity fingerprint domains", () => {
    expect(loginFingerprint("test-secret", "source", "same")).not.toBe(
      loginFingerprint("test-secret", "identity", "same"),
    );
  });

  it("accepts only Vercel's single validated client-IP header in production", () => {
    expect(
      trustedLoginSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.9" }), {
        VERCEL: "1",
      }),
    ).toBe("203.0.113.9");
    expect(
      trustedLoginSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1" }), {
        VERCEL: "1",
      }),
    ).toBeNull();
    expect(
      trustedLoginSource(new Headers({ "x-vercel-forwarded-for": "attacker-value" }), {
        VERCEL: "1",
      }),
    ).toBeNull();
    expect(
      trustedLoginSource(new Headers({ "x-forwarded-for": "203.0.113.9" }), { VERCEL: "1" }),
    ).toBeNull();
  });

  it("does not trust caller-supplied forwarding headers outside Vercel", () => {
    expect(
      trustedLoginSource(new Headers({ "x-vercel-forwarded-for": "198.51.100.7" }), {}),
    ).toBe("127.0.0.1");
  });
});

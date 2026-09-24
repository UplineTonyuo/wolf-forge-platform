import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { activateAccountAction } from "../app/actions/account-activation";
import { ACTIVATION_LINK_DAYS, clientWelcomeEmail } from "../lib/email/client-welcome-email";
import {
  sendClientWelcomeEmail,
  type ClientWelcomeEmailDependencies,
} from "../lib/email/client-welcome-email-server";
import { GMAIL_OAUTH_CALLBACK_PATH, readGoogleOAuthEnvironment } from "../lib/env/google-oauth-env";
import { GmailReauthorizationRequiredError, GoogleOAuthClient } from "../lib/integrations/google-oauth-client";

const trusted = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { admin: { updateUserById: vi.fn() } },
}));

vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => trusted }));

const base = {
  name: "Jane Doe",
  email: "jane@acme.test",
  activationUrl: "https://portal.wolfforge.test/activate#token=abc",
};

describe("client welcome email template", () => {
  it("carries the greeting, login email and set-password link in both parts, and never a password", () => {
    const { subject, text, html } = clientWelcomeEmail(base);

    expect(subject).toBe("Your Wolf Forge client portal is ready");
    for (const part of [text, html]) {
      expect(part).toContain("Hi Jane Doe,");
      expect(part).toContain("jane@acme.test");
      expect(part).toContain("https://portal.wolfforge.test/activate#token=abc");
      expect(part).toContain(`expires in ${ACTIVATION_LINK_DAYS} days`);
      expect(part).not.toMatch(/temporary password/i);
    }
    expect(html).toContain('href="https://portal.wolfforge.test/activate#token=abc"');
  });

  it("never greets with a missing or email-shaped display name", () => {
    for (const name of [null, "  ", "jane@acme.test"]) {
      expect(clientWelcomeEmail({ ...base, name }).text.startsWith("Hello,")).toBe(true);
    }
  });

  it("escapes every value it interpolates into the HTML", () => {
    const { html } = clientWelcomeEmail({ ...base, name: "<img src=x onerror=alert(1)>" });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("refuses a non-https link, except a local dev server, and an unaddressable recipient", () => {
    for (const activationUrl of ["javascript:alert(1)", "http://portal.wolfforge.test/activate", "data:text/html,x"]) {
      expect(() => clientWelcomeEmail({ ...base, activationUrl })).toThrow();
    }
    expect(() => clientWelcomeEmail({ ...base, activationUrl: "http://127.0.0.1:3000/activate#token=abc" })).not.toThrow();
    expect(() => clientWelcomeEmail({ ...base, email: "not-an-email" })).toThrow();
  });

  it("stays inside what email clients render: no scripts, images, forms or remote styles, no em dash", () => {
    const { subject, text, html } = clientWelcomeEmail(base);

    expect(html).not.toMatch(/<(script|img|form|link|iframe|style)\b/i);
    expect(html).not.toMatch(/\son\w+=/i);
    for (const part of [subject, text, html]) {
      expect(part).not.toContain("—");
    }
  });
});

describe("Gmail HTML delivery", () => {
  const environment = readGoogleOAuthEnvironment({
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret", // secret-scan:allow(non-issued OAuth test fixture); gitleaks:allow
    GOOGLE_OAUTH_REDIRECT_URI: `http://127.0.0.1:3000${GMAIL_OAUTH_CALLBACK_PATH}`,
  });

  async function sentRaw(message: Parameters<GoogleOAuthClient["send"]>[1]): Promise<string> {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "gmail-id" }));
    await expect(new GoogleOAuthClient(environment, fetcher).send("access", message)).resolves.toBe("gmail-id");
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { raw: string };
    return Buffer.from(body.raw, "base64url").toString("utf8");
  }

  it("sends multipart/alternative with the plain part first and both parts byte-exact", async () => {
    const html = "<p>Ünïcode ✓ set your password</p>".repeat(40);
    const raw = await sentRaw({ to: "jane@acme.test", subject: "Welcome", text: "Plain ✓", html });
    const decode = (part: string) =>
      Buffer.from(part.split("\r\n\r\n")[1]?.replaceAll("\r\n", "") ?? "", "base64").toString("utf8");

    expect(raw).toContain('Content-Type: multipart/alternative; boundary="wf_alternative_part"');
    const parts = raw.split("--wf_alternative_part");
    expect(parts).toHaveLength(4);
    expect(parts[1]).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decode(parts[1] ?? "")).toBe("Plain ✓");
    expect(parts[2]).toContain("Content-Type: text/html; charset=UTF-8");
    expect(decode(parts[2] ?? "")).toBe(html);
    expect(parts[3]).toBe("--");
    expect(raw.split("\r\n").every((line) => line.length <= 998)).toBe(true);
  });

  it("keeps a plain-text message plain", async () => {
    const raw = await sentRaw({ to: "jane@acme.test", subject: "Connection test", text: "No client delivery." });

    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).not.toContain("multipart");
  });
});

function dependencies() {
  return {
    claim: vi.fn<ClientWelcomeEmailDependencies["claim"]>(async () => ({
      outcome: "claimed",
      email: "jane@acme.test",
      name: "Jane Doe",
    })),
    finish: vi.fn<ClientWelcomeEmailDependencies["finish"]>(async () => undefined),
    send: vi.fn<ClientWelcomeEmailDependencies["send"]>(async () => "gmail-id"),
    origin: "https://portal.wolfforge.test",
  };
}

describe("welcome email delivery", () => {
  function sentToken(deps: ReturnType<typeof dependencies>): string {
    return /#token=([\w-]+)/u.exec(deps.send.mock.calls[0]?.[0]?.text ?? "")?.[1] ?? "";
  }

  it("stores only the link's SHA-256, and stores it before Gmail sees the message", async () => {
    const deps = dependencies();

    await expect(sendClientWelcomeEmail("profile-1", "request-1", deps)).resolves.toBe("sent");

    const message = deps.send.mock.calls[0]?.[0];
    const token = sentToken(deps);
    expect(token).toHaveLength(43);
    expect(message?.to).toBe("jane@acme.test");
    expect(message?.html).toContain(`https://portal.wolfforge.test/activate#token=${token}`);
    expect(deps.claim).toHaveBeenCalledWith("profile-1", "request-1", createHash("sha256").update(token).digest("hex"));
    expect(deps.claim.mock.invocationCallOrder[0]).toBeLessThan(deps.send.mock.invocationCallOrder[0] ?? 0);
    expect(deps.finish).toHaveBeenCalledWith("profile-1", "request-1", null);
    expect(JSON.stringify([deps.claim.mock.calls, deps.finish.mock.calls])).not.toContain(token);
  });

  it("still reports sent when recording the result fails after Gmail accepted it", async () => {
    const deps = dependencies();
    deps.finish.mockRejectedValue(new Error("database unavailable"));

    await expect(sendClientWelcomeEmail("profile-1", "request-1", deps)).resolves.toBe("sent");
    // The emailed link's hash went in with the claim, so the link works regardless.
    expect(deps.claim.mock.calls[0]?.[2]).toBe(createHash("sha256").update(sentToken(deps)).digest("hex"));
  });

  it("records a failed send", async () => {
    const deps = dependencies();
    deps.send.mockRejectedValue(new GmailReauthorizationRequiredError());

    await expect(sendClientWelcomeEmail("profile-1", "request-1", deps)).resolves.toBe("failed");
    expect(deps.finish).toHaveBeenCalledWith("profile-1", "request-1", "gmail_reauthorization_required");
  });

  it("sends nothing when the claim is refused or was already answered", async () => {
    for (const outcome of ["sent", "failed", "in_progress", "recently_sent", "activated"] as const) {
      const deps = dependencies();
      deps.claim.mockResolvedValue({ outcome });

      await expect(sendClientWelcomeEmail("profile-1", "request-1", deps)).resolves.toBe(outcome);
      expect(deps.send).not.toHaveBeenCalled();
      expect(deps.finish).not.toHaveBeenCalled();
    }
  });
});

describe("set-password link", () => {
  const token = "a".repeat(43);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const profileId = "30000000-0000-4000-8000-000000000001";

  function submit(fields: Record<string, string>) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ token, password: "correct horse", confirm_password: "correct horse", ...fields })) {
      form.set(key, value);
    }
    return activateAccountAction({ error: null, done: false }, form);
  }

  function mockLink(found: string | null) {
    trusted.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "app_server_find_client_activation" ? found : null,
      error: null,
    }));
    trusted.auth.admin.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
  }

  it("rejects a malformed token, a bad password and an unknown link without setting anything", async () => {
    mockLink(null);

    const refused: Record<string, string>[] = [{ token: "short" }, { password: "short", confirm_password: "short" }, { confirm_password: "different" }];
    for (const fields of refused) {
      expect((await submit(fields)).done).toBe(false);
    }
    expect(trusted.rpc).not.toHaveBeenCalled();

    expect((await submit({})).error).toMatch(/invalid, already used or expired/u);
    expect(trusted.rpc).toHaveBeenCalledWith("app_server_find_client_activation", { p_token_hash: tokenHash });
    expect(trusted.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("keeps the link usable when the password is refused", async () => {
    mockLink(profileId);
    trusted.auth.admin.updateUserById.mockResolvedValue({ data: {}, error: { code: "weak_password", message: "weak" } });

    expect((await submit({})).error).toMatch(/too weak/u);
    expect(trusted.rpc).not.toHaveBeenCalledWith("app_server_complete_client_activation", expect.anything());
  });

  it("sets the password, then spends the link by its hash only", async () => {
    mockLink(profileId);

    await expect(submit({})).resolves.toEqual({ error: null, done: true });
    expect(trusted.auth.admin.updateUserById).toHaveBeenCalledWith(profileId, { password: "correct horse" });
    expect(trusted.rpc).toHaveBeenLastCalledWith("app_server_complete_client_activation", {
      p_profile_id: profileId,
      p_token_hash: tokenHash,
    });
    expect(JSON.stringify(trusted.rpc.mock.calls)).not.toContain(token);
  });
});

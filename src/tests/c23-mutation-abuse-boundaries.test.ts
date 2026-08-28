import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RateLimitedError, PermissionDeniedError } from "../lib/errors/application-error";
import { ProfileService } from "../services/profile-service";
import type { ProfileRepository } from "../repositories/profile-repository";
import { createUserSupabaseClient, verifyActor } from "../lib/supabase/user-client";

/**
 * Security C2-3 — abuse / bot / mutation protection, application boundary.
 *
 * The enforcement itself is in the database and is proved there, by
 * `supabase/tests/database/042_c23_abuse_rate_limits.test.sql`. What only the
 * application can get wrong — and what this suite exists to pin — is ORDER.
 *
 * `app_set_my_avatar` cannot defend the thing that actually costs money. The
 * 5 MB object lands in Supabase Storage under its own owner-scoped INSERT
 * policy, without consulting any RPC, so a throttle on the persist call fires
 * only after the bytes are already written. C2-3 therefore added a pre-flight
 * claim that the SERVICE must consume BEFORE it uploads. That ordering is not
 * expressible in SQL; it lives in one method, and a well-meaning refactor that
 * moves the claim below the upload would silently restore the whole exposure
 * while every database test kept passing.
 *
 * So these tests drive the real `ProfileService` against a recording double and
 * assert what happened, in what order, and — for the denial cases — that
 * nothing happened at all.
 */

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

/** A 1x1 PNG, small but structurally real: the service identifies uploads by file signature. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

type Call = "claim" | "upload" | "persist" | "removeObject" | "clear";

function repositoryDouble(overrides: Partial<Record<Call, () => Promise<unknown>>> = {}) {
  const calls: Call[] = [];

  const record = <T>(name: Call, fallback: () => Promise<T>) => {
    return async (...args: unknown[]): Promise<T> => {
      void args;
      calls.push(name);
      const override = overrides[name];
      if (override) return (await override()) as T;
      return fallback();
    };
  };

  const repository = {
    claimAvatarUpload: record("claim", async () => undefined),
    uploadAvatarObject: record("upload", async () => undefined),
    publicAvatarUrl: (objectPath: string) => `https://storage.invalid/${objectPath}`,
    setMineAvatar: record<string | null>("persist", async () => null),
    clearMineAvatar: record<string | null>("clear", async () => null),
    removeAvatarObject: record("removeObject", async () => undefined),
  } as unknown as ProfileRepository;

  return { repository, calls };
}

/**
 * A REAL verified actor.
 *
 * `requireVerifiedActor` checks membership of a private WeakSet, so a cast
 * object literal is rejected at runtime and the service cannot be driven with a
 * hand-made stand-in. The actor therefore has to come from `verifyActor` on a
 * genuine user-scoped client — only the claim verification itself is replaced,
 * so no network call is made.
 */
async function verifiedActor() {
  const client = createUserSupabaseClient(
    {
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    } as never,
    "test-access-token",
  );

  client.auth.getClaims = (async () => ({
    data: { claims: { sub: ACTOR_ID, role: "authenticated" } },
    error: null,
  })) as never;

  return verifyActor(client);
}

function service(repository: ProfileRepository) {
  return new ProfileService({ repository } as never);
}

describe("C2-3 avatar upload: the throttle runs before the expensive side effect", () => {
  it("claims the upload BEFORE any bytes reach storage", async () => {
    const { repository, calls } = repositoryDouble();

    const result = await service(repository).saveMineAvatar(
      { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength },
      await verifiedActor(),
    );

    expect(result.ok).toBe(true);
    expect(calls.indexOf("claim")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("claim")).toBeLessThan(calls.indexOf("upload"));
    expect(calls.indexOf("upload")).toBeLessThan(calls.indexOf("persist"));
  });

  it("writes NOTHING when the claim is throttled — no object, no orphan, no cleanup", async () => {
    const { repository, calls } = repositoryDouble({
      claim: async () => {
        throw new RateLimitedError();
      },
    });

    await expect(
      service(repository).saveMineAvatar(
        { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength },
        await verifiedActor(),
      ),
    ).rejects.toBeInstanceOf(RateLimitedError);

    expect(calls).toEqual(["claim"]);
    expect(calls).not.toContain("upload");
    expect(calls).not.toContain("persist");
    // Nothing was written, so there is nothing to clean up. A cleanup call here
    // would mean an object had been created before the throttle was consulted.
    expect(calls).not.toContain("removeObject");
  });

  it("writes NOTHING when the claim refuses the caller on authorization", async () => {
    // The claim applies the same gate as the persist RPC. A client-portal
    // account is refused here rather than after uploading 5 MB it can never
    // persist.
    const { repository, calls } = repositoryDouble({
      claim: async () => {
        throw new PermissionDeniedError();
      },
    });

    await expect(
      service(repository).saveMineAvatar(
        { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength },
        await verifiedActor(),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(calls).toEqual(["claim"]);
  });

  it("spends no allowance on a payload the service rejects on its own", async () => {
    // Malformed input is refused before the claim, so a caller cannot drain its
    // own honest allowance — or fill the counter table — with junk bytes.
    const { repository, calls } = repositoryDouble();

    const result = await service(repository).saveMineAvatar(
      { bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03]) },
      await verifiedActor(),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("still refuses an unverified actor before consuming anything", async () => {
    const { repository, calls } = repositoryDouble();

    await expect(
      service(repository).saveMineAvatar({ bytes: PNG_BYTES }, {
        id: ACTOR_ID,
      } as never),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
  });

  it("still removes the superseded object after a successful replacement", async () => {
    // The C2-3 claim must not have disturbed the replacement sequence: the old
    // object is deleted only after the new one is durable.
    const { repository, calls } = repositoryDouble({
      persist: async () => "old/path.png",
    });

    const result = await service(repository).saveMineAvatar(
      { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength },
      await verifiedActor(),
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["claim", "upload", "persist", "removeObject"]);
  });

  it("still cleans up the orphan when persistence fails after a successful claim", async () => {
    const { repository, calls } = repositoryDouble({
      persist: async () => {
        throw new Error("persist failed");
      },
    });

    await expect(
      service(repository).saveMineAvatar(
        { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength },
        await verifiedActor(),
      ),
    ).rejects.toThrow("persist failed");

    expect(calls).toEqual(["claim", "upload", "persist", "removeObject"]);
  });

  it("does not claim an upload when the caller is only REMOVING a photo", async () => {
    // Removal writes no object. Charging it the upload allowance would let a
    // user lock themselves out of deleting their own photo.
    const { repository, calls } = repositoryDouble({ clear: async () => "old/path.png" });

    await service(repository).removeMineAvatar(await verifiedActor());

    expect(calls).toEqual(["clear", "removeObject"]);
    expect(calls).not.toContain("claim");
  });
});

describe("C2-3 rate-limit responses stay stable and say nothing useful to an abuser", () => {
  it("tells a throttled uploader to wait instead of telling them to retry now", async () => {
    // "Try again" is wrong advice for a caller who has to wait. The throttle's
    // own message is already generic, so surfacing it leaks nothing.
    const rateLimited = new RateLimitedError();

    expect(rateLimited.code).toBe("RATE_LIMITED");
    expect(rateLimited.message).toBe("Too many requests. Please wait a moment and try again.");
    expect(rateLimited.message).not.toMatch(/avatar|profile|coupon|invoice|bucket|scope|limit \d/i);
  });

  it("names no bucket, scope, window or limit anywhere in the C2-3 migrations' error text", () => {
    const root = resolve(import.meta.dirname, "../..");
    const migrations = [
      "supabase/migrations/20260824090000_c23_abuse_rate_limits.sql",
      "supabase/migrations/20260825170000_c23_self_service_profile_rate_limits.sql",
    ].map((path) => readFileSync(resolve(root, path), "utf8"));

    for (const sql of migrations) {
      // No raised exception may interpolate a scope or subject: PostgREST
      // forwards MESSAGE, DETAIL and HINT to the caller verbatim.
      const raises = sql.match(/raise exception[^;]*/gi) ?? [];
      for (const raise of raises) {
        expect(raise).not.toMatch(/actor\.minute|actor\.hour|actor\.day|consume_rate_limit/);
      }
    }
  });
});

describe("C2-3 does not reverse the settled login posture", () => {
  // KI-022 / D-085 were revised by the production login hardening pass: the
  // application now DOES enforce a durable, multi-instance login limiter
  // (`lib/security/login-protection.ts`, migration
  // `20260827094453_production_login_cost_abuse_hardening.sql`). That is a
  // recorded decision, not drift — see the "Brute-force posture" note in
  // `domain/auth/login-flow.ts` and `docs/production-login-cost-abuse-hardening.md`.
  // What must still hold, and what the old test collapsed into one overbroad
  // ban, is the actual invariant B2 cares about: the limiter RPCs stay
  // service-role-only (never anon- or authenticated-callable), and identity
  // pressure alone never denies a login — only a source+identity pair does.
  it("never grants the login limiter RPCs to anon or authenticated", () => {
    const root = resolve(import.meta.dirname, "../..");
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260827094453_production_login_cost_abuse_hardening.sql"),
      "utf8",
    );

    for (const fn of [
      "app_login_rate_limit_preflight",
      "app_record_login_failure",
      "app_clear_login_pair_failures",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*\\n\\s*to service_role;`));
      expect(sql).not.toMatch(new RegExp(`grant [^;]*${fn}[^;]*to (anon|authenticated)`, "i"));
    }
  });

  it("keeps the durable limiter confined to the trusted login-protection module", () => {
    // auth.ts and login-flow.ts must reach the database limiter only through
    // lib/security/login-protection.ts, never by calling a limiter RPC
    // directly — that is what keeps the service-role client out of ordinary
    // action code.
    const root = resolve(import.meta.dirname, "..");
    const loginSurfaces = ["app/actions/auth.ts", "domain/auth/login-flow.ts"].map((path) =>
      readFileSync(resolve(root, path), "utf8"),
    );

    for (const source of loginSurfaces) {
      expect(source).not.toMatch(/\.rpc\(\s*["'`]app_(login_rate_limit_preflight|record_login_failure|clear_login_pair_failures)/);
    }
  });

  it("grants the C2-3 claim RPC to authenticated only — never to anon", () => {
    const root = resolve(import.meta.dirname, "../..");
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260825170000_c23_self_service_profile_rate_limits.sql"),
      "utf8",
    );

    expect(sql).toMatch(
      /revoke all on function public\.app_claim_avatar_upload\(\)\s*\n\s*from public, anon, authenticated, service_role;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.app_claim_avatar_upload\(\) to authenticated;/,
    );
    expect(sql).not.toMatch(/grant [^;]*app_claim_avatar_upload[^;]*to anon/i);
  });
});

describe("C2-3 keeps economic truth server-authoritative", () => {
  it("takes no browser-supplied price, discount, balance or payment state on either money rail", () => {
    const root = resolve(import.meta.dirname, "../..");
    const coupons = readFileSync(
      resolve(root, "supabase/migrations/20260823150000_store_and_invoice_coupons.sql"),
      "utf8",
    );
    const c23 = readFileSync(
      resolve(root, "supabase/migrations/20260824090000_c23_abuse_rate_limits.sql"),
      "utf8",
    );

    /* The PARAMETER LIST only — the function name itself legitimately says
     * "with_balance", and matching it would make this assertion self-defeating. */
    const parameterList = (sql: string, marker: string) => {
      const body = sql.slice(sql.indexOf(marker));
      return body.slice(body.indexOf("(") + 1, body.indexOf(")"));
    };

    const walletArgs = parameterList(
      c23,
      "create or replace function public.app_pay_invoice_with_wallet",
    );
    const purchaseArgs = parameterList(
      coupons,
      "create or replace function public.app_purchase_service_with_balance",
    );

    expect(walletArgs).toMatch(/p_request_id/);
    expect(walletArgs).not.toMatch(/amount|price|discount|total|balance/i);

    expect(purchaseArgs).toMatch(/p_request_id/);
    expect(purchaseArgs).not.toMatch(/amount|price|discount|total|balance/i);
  });

  it("consumes the wallet throttle after the replay short-circuit and before any lock", () => {
    // A genuine retry is a replay and must never be counted as new abuse
    // (D-085); a burst of unique request ids must never reach the row locks.
    const root = resolve(import.meta.dirname, "../..");
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824090000_c23_abuse_rate_limits.sql"),
      "utf8",
    );

    const body = sql.slice(
      sql.indexOf("create or replace function public.app_pay_invoice_with_wallet"),
    );

    const replay = body.indexOf("find_create_request");
    const throttle = body.indexOf("invoice.pay.actor.minute");
    const lock = body.indexOf("for update");

    expect(replay).toBeGreaterThan(-1);
    expect(throttle).toBeGreaterThan(replay);
    expect(lock).toBeGreaterThan(throttle);
  });
});

describe("C2-3 introduces no shared or global bucket", () => {
  it("keys every new bucket on the actor, so no account can deny the surface to another", () => {
    const root = resolve(import.meta.dirname, "../..");
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260825170000_c23_self_service_profile_rate_limits.sql"),
      "utf8",
    );

    const consumptions = sql.match(/consume_rate_limit\(\s*'[^']+',\s*[^,]+,/g) ?? [];
    expect(consumptions.length).toBeGreaterThan(0);

    for (const consumption of consumptions) {
      // Every subject is the server-derived actor id. A literal subject would
      // be a shared bucket and a denial-of-service primitive.
      expect(consumption).toMatch(/actor_id::text,\s*$/);
    }
  });
});

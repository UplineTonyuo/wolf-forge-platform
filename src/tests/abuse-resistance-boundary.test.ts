import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../lib/errors/application-error";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { submitFormSchema, correctFormSubmissionSchema } from "../domain/forms/schema";
import { isBotVerificationConfigured } from "../domain/security/bot-verification";

const FIELD_KEY = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

function submission(overrides: Record<string, unknown> = {}) {
  return {
    request_id: REQUEST_ID,
    form_version_id: VERSION_ID,
    values: [{ field_key: FIELD_KEY, value: "answer" }],
    ...overrides,
  };
}

describe("Batch B2 abuse-resistance application boundary", () => {
  describe("throttle errors", () => {
    it("maps the database throttle SQLSTATE to a dedicated error rather than a generic failure", () => {
      // private.consume_rate_limit raises WF429. PostgREST returns it as a
      // 400 whose `code` is the SQLSTATE, which is what the repositories read.
      const mapped = mapDatabaseError({ code: "WF429", message: "rate limit exceeded" });
      expect(mapped).toBeInstanceOf(RateLimitedError);
      expect(mapped.code).toBe("RATE_LIMITED");
    });

    it("tells the caller to wait without naming the control they tripped", () => {
      const mapped = mapDatabaseError({
        code: "WF429",
        message: "rate limit exceeded",
        hint: "Too many requests. Please wait and try again.",
      });
      expect(mapped.message).toBe("Too many requests. Please wait a moment and try again.");
      expect(mapped.message).not.toMatch(/form\.submit|ticket\.reply|store\.interest/);
    });

    it("does not reclassify a throttle as a permission or validation failure", () => {
      expect(mapDatabaseError({ code: "42501" }).code).toBe("PERMISSION_DENIED");
      expect(mapDatabaseError({ code: "22023" }).code).toBe("VALIDATION_ERROR");
      expect(mapDatabaseError({ code: "WF429" }).code).toBe("RATE_LIMITED");
    });
  });

  describe("Form submission payload bounds", () => {
    it("accepts an ordinary submission", () => {
      expect(submitFormSchema.parse(submission())).toMatchObject({
        request_id: REQUEST_ID,
        form_version_id: VERSION_ID,
      });
    });

    it("agrees with the database answer-count cap of 300", () => {
      const atCap = Array.from({ length: 300 }, (_, index) => ({
        field_key: `${index.toString().padStart(8, "0")}-1111-4111-8111-111111111111`,
        value: "answer",
      }));
      expect(() => submitFormSchema.parse(submission({ values: atCap }))).not.toThrow();

      const overCap = [
        ...atCap,
        { field_key: "99999999-9999-4999-8999-999999999999", value: "answer" },
      ];
      expect(() => submitFormSchema.parse(submission({ values: overCap }))).toThrow();
      expect(() =>
        correctFormSubmissionSchema.parse({ request_id: REQUEST_ID, values: overCap }),
      ).toThrow();
    });
  });

  describe("bot-challenge token", () => {
    it("carries a challenge token through the submit context", () => {
      const parsed = submitFormSchema.parse(
        submission({ context: { bot_token: "provider-issued-token" } }),
      );
      expect(parsed.context.bot_token).toBe("provider-issued-token");
    });

    it("stays optional so anonymous public Forms keep working while no provider is configured", () => {
      expect(submitFormSchema.parse(submission()).context.bot_token).toBeUndefined();
    });

    it("rejects a blank or oversized token before it reaches the database", () => {
      expect(() => submitFormSchema.parse(submission({ context: { bot_token: "   " } }))).toThrow();
      expect(() =>
        submitFormSchema.parse(submission({ context: { bot_token: "t".repeat(4097) } })),
      ).toThrow();
    });

    it("still refuses any context key nobody decided on", () => {
      expect(() =>
        submitFormSchema.parse(submission({ context: { captcha: "anything" } })),
      ).toThrow();
    });
  });

  describe("bot-verification seam", () => {
    it("reports itself unconfigured when no provider credentials exist", () => {
      expect(isBotVerificationConfigured({})).toBe(false);
      expect(isBotVerificationConfigured({ BOT_VERIFICATION_PROVIDER: "turnstile" })).toBe(false);
      expect(
        isBotVerificationConfigured({
          BOT_VERIFICATION_PROVIDER: "turnstile",
          BOT_VERIFICATION_SECRET_KEY: "   ",
        }),
      ).toBe(false);
    });

    it("recognises a fully configured provider", () => {
      expect(
        isBotVerificationConfigured({
          BOT_VERIFICATION_PROVIDER: "turnstile",
          BOT_VERIFICATION_SECRET_KEY: "secret",
        }),
      ).toBe(true);
    });

    // createBotVerificationGateway() throwing rather than returning a fake
    // "verified" is asserted by inspection only: it lives behind `server-only`,
    // the same way createPayPalGateway() does, and no suite in this repository
    // imports a server-only module.
  });
});

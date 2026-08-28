import { describe, expect, it } from "vitest";
import { systemActivitySchema } from "../domain/activity/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { toClientSafeError } from "../lib/errors/application-error";

const id = "10000000-0000-4000-8000-000000000001";

describe("activity action construction", () => {
  it("still validates the entity/action taxonomy for a trusted actor-bearing event", () => {
    const result = systemActivitySchema.safeParse({ entity_type: "order", entity_id: id, action: "order.updated", summary: "Updated order", actor_profile_id: id });
    expect(result.success).toBe(true);
    expect(systemActivitySchema.safeParse({ entity_type: "order", entity_id: id, action: "order.invented", summary: "Updated order", actor_profile_id: id }).success).toBe(false);
  });

  it("allows actorless trusted system activity", () => {
    const result = systemActivitySchema.safeParse({ entity_type: "service", entity_id: id, action: "service.updated", summary: "Synchronized service", actor_profile_id: null });
    expect(result.success).toBe(true);
  });

  it("keeps entity type separate from action taxonomy", () => {
    expect(systemActivitySchema.safeParse({ entity_type: "order.status_changed", entity_id: id, action: "order.status_changed", summary: "Changed" }).success).toBe(false);
  });
});

describe("repository error mapping", () => {
  it.each([
    ["42501", "PERMISSION_DENIED"],
    ["23505", "CONFLICT"],
    ["23514", "VALIDATION_ERROR"],
    ["PGRST116", "NOT_FOUND"],
    ["02000", "NOT_FOUND"],
    ["XX000", "DATABASE_ERROR"],
  ])("maps %s while keeping the user-facing message free of database detail", (databaseCode, expectedCode) => {
    const error = mapDatabaseError({ code: databaseCode, message: "sensitive database detail" });
    expect(error.code).toBe(expectedCode);
    expect(error.message).not.toContain("sensitive database detail");
    expect(error.cause).toBeDefined();
  });

  it("serializes only safe code and message fields", () => {
    const sensitive = { message: "duplicate key", details: "table companies", hint: "constraint companies_name_key", stack: "secret stack" };
    const error = mapDatabaseError({ code: "23505", ...sensitive });
    const serialized = JSON.stringify(error);
    expect(JSON.parse(serialized)).toEqual({ code: "CONFLICT", message: "A record with these values already exists." });
    expect(serialized).not.toContain("companies");
    expect(serialized).not.toContain("constraint");
    expect(error.cause).toEqual({ code: "23505", ...sensitive });
  });

  it("maps unknown failures to a generic client boundary", () => {
    expect(toClientSafeError(new Error("password=do-not-leak"))).toEqual({
      code: "DATABASE_ERROR",
      message: "The operation failed.",
    });
  });

  it("keeps spread and client-safe serialization free of the internal cause", () => {
    const error = mapDatabaseError({ code: "02000", message: "sensitive missing-row detail" }, "Project");

    expect({ ...error }).not.toHaveProperty("cause");
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "NOT_FOUND",
      message: "Project was not found.",
    });
    expect(toClientSafeError(error)).toEqual({
      code: "NOT_FOUND",
      message: "Project was not found.",
    });
  });

  it("documents that reflective server code can see cause while safe paths cannot", () => {
    const error = mapDatabaseError({ code: "XX000", message: "internal only" });
    expect(Object.getOwnPropertyNames(error)).toContain("cause");
    expect(error.cause).toEqual({ code: "XX000", message: "internal only" });
    expect(JSON.stringify(error)).not.toContain("internal only");
  });
});

/**
 * WF430 (Slow Mode) vs WF429 (anti-abuse rate limiting) — a Codex red-team
 * review (M1) found the two had collapsed into one generic "Too many
 * requests" message, discarding the authoritative remaining-seconds value
 * `private.enforce_team_slow_mode` had already computed. The two codes must
 * map to distinct error types with distinct, purpose-appropriate messages.
 */
describe("Slow Mode vs anti-abuse error mapping (WF430 vs WF429)", () => {
  it("still maps WF429 to the deliberately generic anti-abuse message", () => {
    const error = mapDatabaseError({ code: "WF429", message: "rate limit exceeded" });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toBe("Too many requests. Please wait a moment and try again.");
  });

  it("maps WF430 to a distinct code with the authoritative remaining seconds in the message", () => {
    const error = mapDatabaseError({
      code: "WF430",
      message: "slow mode is active for this conversation",
      details: "5",
      hint: "Slow mode is on. Wait 5 more seconds.",
    });
    expect(error.code).toBe("SLOW_MODE_ACTIVE");
    expect(error.message).toBe("Slow mode is on. You can send again in 5 seconds.");
  });

  it("singularizes the message for exactly one second remaining", () => {
    const error = mapDatabaseError({ code: "WF430", details: "1" });
    expect(error.message).toBe("Slow mode is on. You can send again in 1 second.");
  });

  it("serializes retryAfterSeconds for the client, unlike the anonymous WF429 path", () => {
    const error = mapDatabaseError({ code: "WF430", details: "12", hint: "Slow mode is on. Wait 12 more seconds." });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "SLOW_MODE_ACTIVE",
      message: "Slow mode is on. You can send again in 12 seconds.",
      retryAfterSeconds: 12,
    });
  });

  it("degrades to a message with no specific number when the detail cannot be parsed, without throwing", () => {
    const error = mapDatabaseError({ code: "WF430", details: undefined });
    expect(error.code).toBe("SLOW_MODE_ACTIVE");
    expect(error.message).toBe("Slow mode is on for this conversation. Please wait before sending again.");
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "SLOW_MODE_ACTIVE",
      message: "Slow mode is on for this conversation. Please wait before sending again.",
    });
  });
});

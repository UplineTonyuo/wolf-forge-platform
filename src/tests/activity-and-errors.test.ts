import { describe, expect, it } from "vitest";
import { systemActivitySchema, userActivitySchema } from "../domain/activity/schema.js";
import { mapDatabaseError } from "../lib/errors/map-database-error.js";
import { toClientSafeError } from "../lib/errors/application-error.js";

const id = "10000000-0000-4000-8000-000000000001";

describe("activity action construction", () => {
  it("requires an actor_profile_id to be supplied", () => {
    const result = userActivitySchema.safeParse({ entity_type: "order", entity_id: id, action: "order.updated", summary: "Updated order" });
    expect(result.success).toBe(false);
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

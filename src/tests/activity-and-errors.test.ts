import { describe, expect, it } from "vitest";
import { systemActivitySchema, userActivitySchema } from "../domain/activity/schema.js";
import { mapDatabaseError } from "../lib/errors/map-database-error.js";

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
    ["XX000", "DATABASE_ERROR"],
  ])("maps %s while keeping the user-facing message free of database detail", (databaseCode, expectedCode) => {
    const error = mapDatabaseError({ code: databaseCode, message: "sensitive database detail" });
    expect(error.code).toBe(expectedCode);
    expect(error.message).not.toContain("sensitive database detail");
    expect(error.cause).toBeDefined();
  });
});

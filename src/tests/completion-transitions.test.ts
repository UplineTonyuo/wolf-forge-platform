import { describe, expect, it } from "vitest";
import { changeOrderStatusSchema } from "../domain/orders/schema";
import { changeTaskStatusSchema } from "../domain/tasks/schema";

describe("completion transitions", () => {
  it.each([changeOrderStatusSchema, changeTaskStatusSchema])(
    "accepts a status but strips caller-supplied completion timestamps",
    (schema) => {
      expect(schema.parse({ status: "complete", completed_at: "2099-01-01T00:00:00.000Z" }))
        .toEqual({ status: "complete" });
    },
  );

  it("leaves completion timestamp generation to the database RPC", () => {
    expect(changeOrderStatusSchema.parse({ status: "working" })).toEqual({ status: "working" });
  });
});

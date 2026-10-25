import { describe, expect, it } from "vitest";
import { z } from "zod";
import { submitFormSchema } from "../domain/forms/schema";

describe("validation resource bounds", () => {
  it("rejects a constrained collection before validating its elements", () => {
    let visited = 0;
    const schema = z.array(z.string().refine(() => { visited += 1; return true; })).max(2);
    const result = schema.safeParse(["a", "b", "c"]);
    expect(result.success).toBe(false);
    expect(visited).toBe(0);
    expect(result.error?.issues).toHaveLength(1);
  });

  it("rejects an oversized public-form values list before inspecting answer objects", () => {
    let visited = 0;
    const values = Array.from({ length: 301 }, () => ({
      get field_key() { visited += 1; return "10000000-0000-4000-8000-000000000001"; },
      value: "synthetic",
    }));
    const result = submitFormSchema.safeParse({
      request_id: "20000000-0000-4000-8000-000000000001",
      form_version_id: "30000000-0000-4000-8000-000000000001",
      context: {}, values, files: [],
    });
    expect(result.success).toBe(false);
    expect(visited).toBe(0);
    expect(result.error?.issues).toEqual([expect.objectContaining({ code: "too_big", path: ["values"] })]);
  });
});

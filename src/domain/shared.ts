import { z } from "zod";
import { ValidationError } from "../lib/errors/application-error.js";

export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const nullableTimestampSchema = timestampSchema.nullable();
export const nonBlankTextSchema = z.string().trim().min(1);
export const nullableNonBlankTextSchema = nonBlankTextSchema.nullable();

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("The supplied data is invalid.", result.error);
  }
  return result.data;
}

import { z } from "zod";
import { readPublicEnvironment, type EnvironmentSource } from "./public-env";

const serverSecretSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
});

export type ServerEnvironment = ReturnType<typeof readServerEnvironment>;

export function readServerEnvironment(source: EnvironmentSource = process.env) {
  return {
    ...readPublicEnvironment(source),
    ...serverSecretSchema.parse(source),
  };
}

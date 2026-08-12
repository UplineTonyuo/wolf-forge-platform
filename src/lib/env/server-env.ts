import { z } from "zod";
import { readPublicEnvironment } from "./public-env.js";

const serverSecretSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
});

export type ServerEnvironment = ReturnType<typeof readServerEnvironment>;

export function readServerEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return {
    ...readPublicEnvironment(source),
    ...serverSecretSchema.parse(source),
  };
}

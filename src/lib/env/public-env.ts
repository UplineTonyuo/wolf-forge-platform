import { z } from "zod";

const publicEnvironmentSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;
export type EnvironmentSource = Record<string, string | undefined>;

export function readPublicEnvironment(
  source: EnvironmentSource = process.env,
): PublicEnvironment {
  return publicEnvironmentSchema.parse(source);
}

export function assertLocalSupabaseUrl(url: string): void {
  const hostname = new URL(url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("The local workflow only accepts a local Supabase URL.");
  }
}

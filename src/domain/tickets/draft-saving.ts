export function studioDraftSavingAvailable(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === "preview" && env.SUPABASE_URL === "https://rsnmlcyopnxucwgfttyf.supabase.co";
}

import type { PostgrestError } from "@supabase/supabase-js";
import { mapDatabaseError } from "../errors/map-database-error.js";

export function unwrapOne<T>(
  result: { data: T | null; error: PostgrestError | null },
  resource: string,
): T {
  if (result.error) throw mapDatabaseError(result.error, resource);
  if (!result.data) throw mapDatabaseError({ code: "PGRST116" }, resource);
  return result.data;
}

export function unwrapMany<T>(result: { data: T[] | null; error: PostgrestError | null }): T[] {
  if (result.error) throw mapDatabaseError(result.error);
  return result.data ?? [];
}

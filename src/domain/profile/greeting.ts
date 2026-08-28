const compoundGivenNameTitles = new Set([
  "lord",
  "lady",
  "sir",
  "dame",
]);

/**
 * The current profile schema has one canonical `display_name`, but no separate
 * preferred/first-name column. Keep the account menu's full name while deriving
 * the smallest deterministic greeting label from the trusted server-resolved
 * display name. A leading personal title keeps the following given name, which
 * makes "Lord Anthony Paghubasan" become "Lord Anthony" rather than "Lord".
 */
export function canonicalGreetingName(displayName: string | null): string | null {
  const parts = displayName?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (parts.length === 0) return null;
  if (parts.length > 1 && compoundGivenNameTitles.has(parts[0]!.toLocaleLowerCase())) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0] ?? null;
}

export function rankNameStrict(name: string, query: string) {
  const normalizedName = name.toLocaleLowerCase().trim().replace(/\s+/g, " ");
  const normalizedQuery = query.toLocaleLowerCase().trim().replace(/\s+/g, " ");

  if (!normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedName.split(" ").some((word) => word.startsWith(normalizedQuery))) return 2;

  const index = normalizedName.indexOf(normalizedQuery);
  return index >= 0 ? 10 + index : Number.POSITIVE_INFINITY;
}

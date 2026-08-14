function normalizeServiceSearch(
  value: string,
) {
  return value
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function serviceNameSearchScore(
  name: string,
  query: string,
): number | null {
  const normalizedName =
    normalizeServiceSearch(name);

  const normalizedQuery =
    normalizeServiceSearch(query);

  if (!normalizedQuery) {
    return 0;
  }

  // Perfect match.
  if (
    normalizedName ===
    normalizedQuery
  ) {
    return 1000;
  }

  // Whole service name begins with query.
  // "ai vis" -> "AI VISIBILITY SPRINT"
  if (
    normalizedName.startsWith(
      normalizedQuery,
    )
  ) {
    return (
      900 -
      Math.min(
        normalizedName.length -
          normalizedQuery.length,
        50,
      )
    );
  }

  const words =
    normalizedName.split(" ");

  // Any word begins with the search.
  // "visibility" -> "AI VISIBILITY SPRINT"
  const wordIndex =
    words.findIndex(
      (word) =>
        word.startsWith(
          normalizedQuery,
        ),
    );

  if (wordIndex !== -1) {
    return 800 - wordIndex;
  }

  // Fallback substring.
  const containsIndex =
    normalizedName.indexOf(
      normalizedQuery,
    );

  if (containsIndex !== -1) {
    return (
      600 -
      Math.min(
        containsIndex,
        100,
      )
    );
  }

  return null;
}

export function compareServiceNameMatches(
  leftName: string,
  rightName: string,
  query: string,
) {
  const leftScore =
    serviceNameSearchScore(
      leftName,
      query,
    ) ?? -1;

  const rightScore =
    serviceNameSearchScore(
      rightName,
      query,
    ) ?? -1;

  if (
    leftScore !==
    rightScore
  ) {
    return (
      rightScore -
      leftScore
    );
  }

  return leftName.localeCompare(
    rightName,
    undefined,
    {
      sensitivity: "base",
    },
  );
}
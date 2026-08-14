function normalize(
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

export function clientNameSearchScore(
  name: string,
  query: string,
): number | null {
  const normalizedName =
    normalize(name);

  const normalizedQuery =
    normalize(query);

  if (!normalizedQuery) {
    return 0;
  }

  // Exact name.
  if (
    normalizedName ===
    normalizedQuery
  ) {
    return 1000;
  }

  // Entire client name begins with query.
  // "lic" -> "Licaros Amil"
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

  // Any individual word begins with query.
  // "pag" -> "Lixer Paghubasan"
  const wordIndex =
    words.findIndex((word) =>
      word.startsWith(
        normalizedQuery,
      ),
    );

  if (wordIndex !== -1) {
    return 800 - wordIndex;
  }

  // Fallback substring.
  // "car" -> "Licaros Amil"
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

export function compareClientSearchMatches(
  leftName: string,
  rightName: string,
  query: string,
) {
  const left =
    clientNameSearchScore(
      leftName,
      query,
    ) ?? -1;

  const right =
    clientNameSearchScore(
      rightName,
      query,
    ) ?? -1;

  if (left !== right) {
    return right - left;
  }

  return leftName.localeCompare(
    rightName,
    undefined,
    {
      sensitivity: "base",
    },
  );
}
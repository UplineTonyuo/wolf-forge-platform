export function wrapServicesFolderIndex(
  index: number,
  total: number,
): number {
  if (!Number.isInteger(total) || total <= 0) {
    return 0;
  }

  return ((index % total) + total) % total;
}

export function closestServicesFolderPosition(
  current: number,
  realIndex: number,
  total: number,
): number {
  if (!Number.isInteger(total) || total <= 0) {
    return 0;
  }

  const normalized =
    wrapServicesFolderIndex(realIndex, total);

  const cycle =
    Math.round((current - normalized) / total);

  const candidates = [
    normalized + (cycle - 1) * total,
    normalized + cycle * total,
    normalized + (cycle + 1) * total,
  ];

  return candidates.reduce(
    (best, candidate) =>
      Math.abs(candidate - current) <
      Math.abs(best - current)
        ? candidate
        : best,
  );
}

export function servicesFolderDragDirection(
  distanceX: number,
  velocityX: number,
  viewportWidth: number,
): -1 | 0 | 1 {
  const width = Math.max(1, viewportWidth);

  const distanceThreshold = Math.min(
    96,
    Math.max(44, width * 0.13),
  );

  const velocityThreshold = 0.34;

  if (
    distanceX <= -distanceThreshold ||
    velocityX <= -velocityThreshold
  ) {
    return 1;
  }

  if (
    distanceX >= distanceThreshold ||
    velocityX >= velocityThreshold
  ) {
    return -1;
  }

  return 0;
}

export function servicesFolderVisibleOffsets(
  total: number,
): number[] {
  if (total <= 0) return [];
  if (total === 1) return [0];
  if (total === 2) return [-1, 0, 1];

  return [-1, 0, 1];
}
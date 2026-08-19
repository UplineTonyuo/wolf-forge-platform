export function wrapFolderDeskIndex(
  index: number,
  total: number,
): number {
  if (!Number.isInteger(total) || total <= 0) {
    return 0;
  }

  return ((index % total) + total) % total;
}

/**
 * Signed circular distance from the active folder to another folder.
 *
 * +1 is the next folder, physically sitting ABOVE the center folder.
 * -1 is the previous folder, physically sitting BELOW the center folder.
 */
export function circularFolderDeskOffset(
  itemIndex: number,
  activeIndex: number,
  total: number,
): number {
  if (!Number.isInteger(total) || total <= 0) {
    return 0;
  }

  const raw =
    wrapFolderDeskIndex(itemIndex - activeIndex, total);

  if (raw === 0) {
    return 0;
  }

  const half = total / 2;

  if (raw > half) {
    return raw - total;
  }

  return raw;
}

/**
 * Vertical physical drag:
 * - drag DOWN pulls the upper/next folder into center => forward
 * - drag UP pulls the lower/previous folder into center => backward
 */
export function folderDeskDragDirection(
  distanceY: number,
  velocityY: number,
  viewportHeight: number,
): -1 | 0 | 1 {
  const height = Math.max(1, viewportHeight);

  const distanceThreshold = Math.min(
    92,
    Math.max(46, height * 0.11),
  );

  const velocityThreshold = 0.34;

  if (
    distanceY >= distanceThreshold ||
    velocityY >= velocityThreshold
  ) {
    return 1;
  }

  if (
    distanceY <= -distanceThreshold ||
    velocityY <= -velocityThreshold
  ) {
    return -1;
  }

  return 0;
}

export function folderDeskRenderable(
  baseOffset: number,
  direction: -1 | 0 | 1,
): boolean {
  const targetOffset =
    baseOffset - direction;

  return (
    Math.abs(baseOffset) <= 2 ||
    Math.abs(targetOffset) <= 2
  );
}
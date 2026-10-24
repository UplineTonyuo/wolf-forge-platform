/** Coordinates are percentages so the same plot fits every viewport. */
export function revenuePlot(values: readonly number[]) {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Revenue points must be finite numbers.");
  }
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const roughStep = Math.max(1, (maximum - minimum) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep) ?? 10) * magnitude;
  const low = Math.floor(minimum / step) * step;
  const high = Math.max(low + step, Math.ceil(maximum / step) * step);
  const y = (value: number) => 100 - ((value - low) / (high - low)) * 100;
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    y: y(value),
  }));
  const line = points.map((point, index) => {
    const previous = points[index - 1];
    if (!previous) return `M ${point.x} ${point.y}`;
    const middle = (previous.x + point.x) / 2;
    // Controls stay between adjacent values; smoothing cannot invent a peak or loss.
    return `C ${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
  }).join(" ");
  const first = points[0];
  const last = points.at(-1);
  const zeroY = y(0);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => {
    const value = high - index * step;
    return { value, y: y(value) };
  });
  return {
    points, line, zeroY, ticks,
    area: first && last ? `${line} L ${last.x} ${zeroY} L ${first.x} ${zeroY} Z` : "",
    hasActivity: values.some((value) => value !== 0),
  };
}

export function revenueTickIndexes(length: number) {
  const count = Math.min(6, length);
  if (count < 2) return length ? [0] : [];
  return Array.from({ length: count }, (_, index) => Math.round((index / (count - 1)) * (length - 1)));
}

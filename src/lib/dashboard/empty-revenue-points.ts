import type { DashboardRange } from "../../domain/dashboard/schema";
import { fromWallClock, toWallClock } from "./date-range";

/** Match Postgres date_trunc buckets when the selected currency has no movements. */
export function emptyRevenuePoints(range: DashboardRange) {
  const wall = toWallClock(new Date(range.start), range.timeZone);
  wall.minute = 0;
  wall.second = 0;
  if (range.bucket !== "hour") wall.hour = 0;
  if (range.bucket === "week") {
    wall.day -= (new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() + 6) % 7;
  }
  const points: { bucket_start: string; net_cents: number }[] = [];
  for (let date = fromWallClock(wall, range.timeZone); date.getTime() < Date.parse(range.end);) {
    points.push({ bucket_start: date.toISOString(), net_cents: 0 });
    const next = toWallClock(date, range.timeZone);
    if (range.bucket === "hour") next.hour += 1;
    else next.day += range.bucket === "week" ? 7 : 1;
    date = fromWallClock(next, range.timeZone);
  }
  return points;
}

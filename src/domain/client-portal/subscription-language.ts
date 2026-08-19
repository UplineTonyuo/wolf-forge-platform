/**
 * Internal billing language, translated for a client.
 *
 * Wolf Forge's internal vocabulary — recurring fulfillment, plan version, cycle
 * lead days, spend — describes how the billing engine works. A client is buying
 * an ongoing service, so they get the word for that instead. Nothing about the
 * underlying subscription model changes; only what it is called on screen.
 */

/**
 * The label for a recurring amount.
 *
 * "Monthly investment" / "Annual investment" rather than "spend" or "MRR". The
 * interval comes from the subscription's own plan version, so a quarterly or
 * six-monthly plan gets an accurate phrase rather than being forced into one of
 * two buckets.
 */
export function recurringAmountLabel(intervalUnit: string, intervalCount: number): string {
  if (intervalCount === 1) {
    switch (intervalUnit) {
      case "year":
        return "Annual investment";
      case "month":
        return "Monthly investment";
      case "week":
        return "Weekly investment";
      case "day":
        return "Daily investment";
      default:
        return "Recurring investment";
    }
  }

  const unit = intervalCount === 1 ? intervalUnit : `${intervalUnit}s`;
  return `Investment every ${intervalCount} ${unit}`;
}

/** How often the service renews, in plain words. */
export function renewalCadence(intervalUnit: string, intervalCount: number): string {
  if (intervalCount === 1) {
    switch (intervalUnit) {
      case "year":
        return "Renews yearly";
      case "month":
        return "Renews monthly";
      case "week":
        return "Renews weekly";
      case "day":
        return "Renews daily";
      default:
        return `Renews every ${intervalUnit}`;
    }
  }

  return `Renews every ${intervalCount} ${intervalUnit}s`;
}

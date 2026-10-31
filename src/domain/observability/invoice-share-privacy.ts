/** A public invoice path contains a bearer capability, including invalid input. */
export function redactInvoiceSharePath(value: string): string {
  return value.replace(/(?:\/|%2f)share(?:\/|%2f)invoices(?:\/|%2f)[^\s"'<>\\]+/gi, "/share/invoices/[token]");
}

/** Sentry error events, streamed spans and breadcrumbs all carry nested URLs.
 * Preserve the SDK payload shape; do not truncate its IDs, timing or frames.
 */
export function sanitizeInvoiceShareTelemetry<T>(value: T): T {
  const seen = new WeakMap<object, object>();
  function scrub(input: unknown): unknown {
    if (typeof input === "string") return redactInvoiceSharePath(input);
    if (!input || typeof input !== "object") return input;
    const previous = seen.get(input);
    if (previous) return previous;
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      seen.set(input, result);
      input.forEach((item) => result.push(scrub(item)));
      return result;
    }
    const result: Record<string, unknown> = {};
    seen.set(input, result);
    for (const [key, item] of Object.entries(input)) {
      Object.defineProperty(result, key, { value: /^(?:p_)?token$/i.test(key) ? "[redacted]" : scrub(item), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return scrub(value) as T;
}

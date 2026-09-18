/**
 * `crypto.randomUUID()` is restricted to secure contexts per spec (HTTPS or
 * localhost) — a LAN IP served over plain HTTP is not one, so the browser
 * exposes no `randomUUID` there even though `crypto` itself still exists.
 * `crypto.getRandomValues()` carries no such restriction, so it is the
 * correct fallback rather than a weaker source of randomness (never
 * `Math.random`, never a timestamp).
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "No secure random source is available: crypto.getRandomValues is missing.",
    );
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

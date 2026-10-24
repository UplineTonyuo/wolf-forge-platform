import { readBoundedText } from "./bounded-text";

/** A small, streaming JSON reader for Route Handlers. */
export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

function declaredLength(request: Request): number | null | "invalid" {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return "invalid";
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : "invalid";
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "Expected a JSON request." };
  }

  const length = declaredLength(request);
  if (length === "invalid") {
    return { ok: false, status: 400, error: "Invalid request length." };
  }
  if (length !== null && length > maxBytes) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  if (!request.body) {
    return { ok: false, status: 400, error: "Invalid JSON request." };
  }

  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) {
    return { ok: false, status: body.status, error: body.status === 413 ? "Request body is too large." : "Invalid JSON request." };
  }
  try {
    return { ok: true, value: JSON.parse(body.value) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request." };
  }
}


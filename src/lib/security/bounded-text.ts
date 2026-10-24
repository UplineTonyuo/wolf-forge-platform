export type BoundedTextResult =
  | { ok: true; value: string }
  | { ok: false; status: 400 | 413 };

/** Retains the signed text while refusing bytes beyond the route's limit. */
export async function readBoundedText(request: Request, maxBytes: number, maxReadMs = 5_000): Promise<BoundedTextResult> {
  const rawLength = request.headers.get("content-length");
  const length = rawLength === null ? null : Number(rawLength);
  if (rawLength !== null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(length))) {
    return { ok: false, status: 400 };
  }
  if (length !== null && length > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void reader.cancel().catch(() => undefined);
  };
  const deadline = setTimeout(interrupt, maxReadMs);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (interrupted) return { ok: false, status: 400 };
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes || (length !== null && total > length)) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, status: total > maxBytes ? 413 : 400 };
      }
      chunks.push(value);
    }
    if (length !== null && total !== length) return { ok: false, status: 400 };
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", interrupt);
    reader.releaseLock();
  }
}

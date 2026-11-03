/** A visible app receives server events independently of OS notification consent. */
export function connectCallSignals(wake: () => Promise<unknown>) {
  if (typeof EventSource === "undefined") return () => {};
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, reading = false, pending = false, failures = 0;
  const refresh = async () => {
    if (disposed) return;
    if (reading) { pending = true; return; }
    reading = true;
    try { do { pending = false; await wake(); } while (pending && !disposed); }
    finally { reading = false; }
  };
  const stop = () => { source?.close(); source = null; clearTimeout(timer); };
  const start = () => {
    if (disposed || source || document.visibilityState !== "visible" || !navigator.onLine) return;
    const current = new EventSource("/api/ticket-call-events"); source = current;
    current.addEventListener("wake", () => { failures = 0; void refresh(); });
    current.addEventListener("disabled", stop);
    current.onerror = () => {
      if (source !== current) return;
      stop();
      // A failed HTTP open is also CLOSED. Only the explicit disabled event stops retries.
      failures = Math.min(failures + 1, 4);
      timer = setTimeout(start, Math.min(60_000, 10_000 * 2 ** (failures - 1)));
    };
  };
  const recover = () => { stop(); failures = 0; start(); };
  start();
  document.addEventListener("visibilitychange", recover);
  window.addEventListener("online", recover);
  window.addEventListener("offline", stop);
  window.addEventListener("focus", recover);
  return () => { disposed = true; stop(); document.removeEventListener("visibilitychange", recover); window.removeEventListener("online", recover); window.removeEventListener("offline", stop); window.removeEventListener("focus", recover); };
}

"use client";

import { useEffect } from "react";
import { DataError } from "../components/ui/list-states";
import { PageFrame } from "../components/ui/page-frame";

/**
 * The ROOT error boundary (D-110).
 *
 * `(internal)/error.tsx` covers the staff application. Everything else — the
 * client portal at `/account/**`, `/login`, and the anonymous public form fill
 * at `/f/[canonicalKey]` — had no boundary of its own and fell through to
 * Next's unbranded default error page. This is that fallback, rendering the
 * same generic state as the internal one.
 *
 * The caught Error's `message`, `stack` and `digest` are deliberately NEVER
 * rendered. Next redacts server-component errors to an opaque digest in
 * production, but a client-side exception still carries its full text in the
 * browser, so printing it here would defeat that redaction — on the two
 * surfaces where the viewer is least likely to be staff. Full detail still goes
 * to the console, which keeps server log diagnostics and client-facing copy
 * separated rather than trading one for the other.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A capability-bearing URL must not travel in an Error/cause/stack.
    if (window.location.pathname.startsWith("/share/invoices/")) {
      console.error("Public invoice page failed.");
    } else {
      console.error(error);
    }
  }, [error]);

  return (
    <PageFrame title="Unable to load">
      <DataError />
      <button className="button-secondary error-retry" onClick={reset}>
        Try again
      </button>
    </PageFrame>
  );
}

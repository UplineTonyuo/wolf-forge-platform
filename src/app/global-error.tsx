"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="global-error-body">
        <title>Unable to load | Wolf Forge</title>
        <main>
          <h1>Unable to load</h1>
          <div className="error-state" role="alert" aria-live="assertive">
            <strong>Unable to load this area.</strong>
            <span>The data could not be loaded.</span>
          </div>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
        <style>{`
          * { box-sizing: border-box; }
          .global-error-body { min-width: 360px; margin: 0; color: #1a1a18; background: #fff; font-family: Inter, system-ui, sans-serif; }
          main { width: min(100%, 1280px); margin: 0 auto; padding: 24px 72px 48px 32px; }
          h1 { margin: 0; padding-bottom: 20px; border-bottom: 1px solid #e2dfda; color: #000d51; font-size: 24px; line-height: 1.2; font-weight: 600; letter-spacing: -.02em; }
          .error-state { margin-top: 24px; padding: 16px; display: grid; gap: 5px; border: 1px solid #d8bebe; border-radius: 6px; color: #8c2f2f; background: #fffafa; font-size: 14px; }
          .error-state strong { font-weight: 600; }
          button { min-height: 40px; margin-top: 12px; padding: 0 16px; border: 1px solid #e2dfda; border-radius: 4px; color: #000d51; background: #fff; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
          button:focus-visible { outline: 2px solid #000d51; outline-offset: 2px; }
          @media (max-width: 720px) { main { padding: 20px 16px 40px; } }
        `}</style>
      </body>
    </html>
  );
}

"use client";

// TEMPORARY: Sentry end-to-end verification surface. Remove after verification.
export function SentryVerificationControls() {
  return (
    <main>
      <button
        type="button"
        onClick={() => {
          const error = new Error("Controlled Sentry browser verification error");
          error.name =
            process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production"
              ? "WolfForgeSentryBrowserProductionVerificationError"
              : "WolfForgeSentryBrowserPreviewVerificationError";
          throw error;
        }}
      >
        Throw browser verification error
      </button>
    </main>
  );
}

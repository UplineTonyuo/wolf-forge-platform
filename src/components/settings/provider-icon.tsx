import type { IntegrationProviderId } from "../../domain/integrations/registry";
import styles from "./settings-foundation.module.css";

export function ProviderIcon({ provider }: { provider: IntegrationProviderId }) {
  if (provider === "gmail") {
    return (
      <span className={`${styles.providerIcon} ${styles.gmailIcon}`} aria-hidden="true">
        <svg viewBox="0 0 28 22" role="presentation">
          <path fill="#4285f4" d="M2 4.4 6.3 7.6V20H2z" />
          <path fill="#34a853" d="M21.7 7.6 26 4.4V20h-4.3z" />
          <path fill="#fbbc04" d="M2 4.4 4.4 2.6 14 9.8v5L2 5.8z" />
          <path fill="#ea4335" d="m26 4.4-2.4-1.8L14 9.8v5l12-9z" />
          <path fill="#c5221f" d="M6.3 7.6 14 13.4l7.7-5.8V20H6.3z" opacity=".14" />
        </svg>
      </span>
    );
  }

  if (provider === "stripe") {
    return (
      <span className={`${styles.providerIcon} ${styles.stripeIcon}`} aria-hidden="true">
        <svg viewBox="0 0 30 30" role="presentation">
          <path d="M15.7 11.5c0-1 .8-1.4 2.2-1.4 2 0 4.5.6 6.5 1.7V5.6a17 17 0 0 0-6.5-1.2c-5.3 0-8.8 2.8-8.8 7.5 0 7.3 10 6.1 10 9.3 0 1.2-1 1.6-2.5 1.6-2.2 0-5-1-7.2-2.3v6.3c2.4 1 4.8 1.5 7.2 1.5 5.4 0 9.1-2.7 9.1-7.5 0-7.8-10-6.4-10-9.3Z" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`${styles.providerIcon} ${styles.paypalIcon}`} aria-hidden="true">
      <svg viewBox="0 0 28 30" role="presentation">
        <path fill="#003087" d="M8 2h9.4c5.8 0 8.2 3 7.2 8-1.2 5.7-5.7 7.7-10.8 7.7h-2.4L9.8 28H3.4z" />
        <path fill="#009cde" d="M12 8h8.8c4.8 0 6.8 2.6 5.8 7.2-1.1 5.2-5.2 7-9.6 7h-2.2L13.7 28H8z" opacity=".92" />
      </svg>
    </span>
  );
}

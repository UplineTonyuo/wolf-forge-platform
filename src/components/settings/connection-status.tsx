import {
  integrationStatusLabel,
  type IntegrationConnectionStatus,
} from "../../domain/integrations/schema";
import styles from "./settings-foundation.module.css";

/**
 * Quiet system badge: the status dot is decorative, the label carries the
 * meaning, so colour is never the only signal.
 */
export function ConnectionStatus({ status }: { status: IntegrationConnectionStatus }) {
  return (
    <span className={`${styles.connectionStatus} ${styles[status]}`}>
      {integrationStatusLabel(status)}
    </span>
  );
}

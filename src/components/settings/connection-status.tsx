import { AlertCircle, CheckCircle2, CircleOff } from "lucide-react";
import {
  integrationStatusLabel,
  type IntegrationConnectionStatus,
} from "../../domain/integrations/schema";
import styles from "./settings-foundation.module.css";

export function ConnectionStatus({ status }: { status: IntegrationConnectionStatus }) {
  const attention = status === "error" || status === "expired";
  const Icon = status === "connected" ? CheckCircle2 : attention ? AlertCircle : CircleOff;

  return (
    <span className={`${styles.connectionStatus} ${styles[status]}`}>
      <Icon aria-hidden="true" />
      {integrationStatusLabel(status)}
    </span>
  );
}

import type { ReactNode } from "react";
import styles from "./department-connection-state.module.css";

/**
 * Honest holding state for a department whose workspace exists before its
 * approved workflow source is connected. It deliberately renders no record
 * count, setup instructions, or speculative worklist structure.
 */
export function DepartmentConnectionState({
  departmentName,
  headingId,
  icon,
}: {
  departmentName: string;
  headingId: string;
  icon: ReactNode;
}) {
  return (
    <section className={styles.connectionState} role="status" aria-labelledby={headingId}>
      <div className={styles.connectionBar}>
        {icon}
        <span>Workflow connection</span>
      </div>
      <div className={styles.connectionBody}>
        <div className={styles.connectionMessage}>
          <h3 id={headingId}>{departmentName} workflow not connected yet</h3>
          <p>
            This workspace is ready for {departmentName} operations. Workflow records and controls
            will appear here after the approved source is connected.
          </p>
        </div>
        <dl className={styles.connectionFacts} aria-label={`${departmentName} workspace readiness`}>
          <div>
            <dt>Workspace</dt>
            <dd className={styles.readyValue}>Ready</dd>
          </div>
          <div>
            <dt>Workflow source</dt>
            <dd>Not connected</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

import { TableSkeleton } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import styles from "../../../../components/team-supervision/supervised-transcript.module.css";

export default function AllConversationsLoading() {
  return (
    <PageFrame title="All Conversations" description="Read-only view of Team conversations." className={styles.frame}>
      <TableSkeleton />
    </PageFrame>
  );
}

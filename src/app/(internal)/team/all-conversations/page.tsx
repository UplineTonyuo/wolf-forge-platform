import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { listSupervisedConversationsAction } from "../../../actions/team-supervision";
import { SupervisedConversationsWorkspace } from "../../../../components/team-supervision/supervised-conversations-workspace";
import styles from "../../../../components/team-supervision/supervised-conversation-list.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";

export const metadata: Metadata = {
  title: "All Conversations",
};

/**
 * Read-only supervision of Team direct conversations. The navigation entry is
 * presentation only: the list RPC behind the action re-checks
 * team_messages.supervise, so a typed URL gets the same refusal. An expired
 * session redirects from inside the action.
 */
export default async function AllConversationsPage() {
  const initial = await listSupervisedConversationsAction();

  return (
    <PageFrame
      title="All Conversations"
      description="Read-only view of Team conversations."
      action={
        <span className={styles.readOnly}>
          <Eye aria-hidden="true" />
          Read-only
        </span>
      }
    >
      <SupervisedConversationsWorkspace initial={initial} />
    </PageFrame>
  );
}

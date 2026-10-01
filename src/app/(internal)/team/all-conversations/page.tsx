import type { Metadata } from "next";
import { listSupervisedConversationsAction } from "../../../actions/team-supervision";
import { teamSupervisionListMaxLimit } from "../../../../domain/team-supervision/schema";
import { SupervisedConversationsWorkspace } from "../../../../components/team-supervision/supervised-conversations-workspace";
import styles from "../../../../components/team-supervision/supervised-transcript.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";

export const metadata: Metadata = {
  title: "All Conversations",
};

/**
 * Read-only supervision of Team direct conversations. The navigation entry is
 * presentation only: the list RPC behind the action re-checks
 * team_messages.supervise, so a typed URL gets the same refusal. An expired
 * session redirects from inside the action.
 *
 * Employees and their people counts are grouped from this list, so it loads
 * every keyset page up front (the list is metadata only and writes no audit).
 * Any failed page fails the whole load rather than show partial counts.
 */
// ponytail: 20 x 100 conversations covers ~60 fully connected employees; past
// that the workspace says counts are partial and offers Load more. A grouped
// RPC is the upgrade if teams get that large.
const maxListPages = 20;
export default async function AllConversationsPage() {
  let initial = await listSupervisedConversationsAction({ limit: teamSupervisionListMaxLimit });
  for (let pages = 1; initial.ok && initial.data.nextCursor && pages < maxListPages; pages++) {
    const next = await listSupervisedConversationsAction({
      ...initial.data.nextCursor,
      limit: teamSupervisionListMaxLimit,
    });
    initial = next.ok
      ? {
          ok: true,
          data: {
            conversations: [...initial.data.conversations, ...next.data.conversations],
            nextCursor: next.data.nextCursor,
          },
        }
      : next;
  }

  return (
    <PageFrame
      title="All Conversations"
      description="Read-only view of Team direct conversations, by employee."
      className={styles.frame}
    >
      <SupervisedConversationsWorkspace initial={initial} />
    </PageFrame>
  );
}

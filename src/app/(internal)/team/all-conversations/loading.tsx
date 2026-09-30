import { TableSkeleton } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function AllConversationsLoading() {
  return (
    <PageFrame title="All Conversations" description="Read-only view of Team conversations.">
      <TableSkeleton />
    </PageFrame>
  );
}

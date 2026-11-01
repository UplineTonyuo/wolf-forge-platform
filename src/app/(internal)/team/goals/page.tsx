import type { Metadata } from "next";
import { GoalListView } from "../../../../components/goals/goal-workspace";
import { canManageGoals } from "../../../../domain/goals/schema";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";
import { GoalRepository } from "../../../../repositories/goal-repository";
import { GoalService } from "../../../../services/goal-service";
export const metadata: Metadata = { title: "Goals" };
export default async function GoalsPage() {
  const context=await getInternalContext(),service=new GoalService(new GoalRepository(context.client));
  try {
    const [data,members]=await Promise.all([service.list(),canManageGoals(context.user.role)?service.members():Promise.resolve([])]);
    return <GoalListView initial={data} members={members} role={context.user.role} actorId={context.actor.id}/>;
  } catch {
    return <PageFrame title="Goals"><p role="alert">Goals could not be loaded. Try reloading this page.</p></PageFrame>;
  }
}

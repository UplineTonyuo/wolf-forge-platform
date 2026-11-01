import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { GoalDetailView } from "../../../../../components/goals/goal-workspace";
import { canManageGoals } from "../../../../../domain/goals/schema";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../../lib/supabase/next-server";
import { GoalRepository } from "../../../../../repositories/goal-repository";
import { GoalService } from "../../../../../services/goal-service";
export const metadata: Metadata = { title: "Goal" };
export default async function GoalPage({params,searchParams}:{params:Promise<{goalId:string}>;searchParams:Promise<{photo?:string}>}) {
  const context=await getInternalContext(),id=z.uuid().safeParse((await params).goalId);
  if(!id.success)notFound();
  const service=new GoalService(new GoalRepository(context.client));
  let goal, members;
  try {
    [goal,members]=await Promise.all([service.get(id.data),canManageGoals(context.user.role)?service.members():Promise.resolve([])]);
  } catch(error) {
    const safe=toClientSafeError(error);
    if(safe.code==="NOT_FOUND"||safe.code==="PERMISSION_DENIED")notFound();
    return <PageFrame title="Goal"><p role="alert">This goal could not be loaded. Try reloading this page.</p></PageFrame>;
  }
  return <GoalDetailView initial={goal} members={members} role={context.user.role} actorId={context.actor.id} photoRetry={(await searchParams).photo==="retry"}/>;
}

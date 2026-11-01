import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveGoalAction, completeGoalMilestoneAction, listGoalsAction } from "../app/actions/goals";
import { PermissionDeniedError } from "../lib/errors/application-error";
const deps=vi.hoisted(()=>({context:vi.fn(),save:vi.fn(),complete:vi.fn(),list:vi.fn(),revalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:deps.revalidate}));
vi.mock("../lib/supabase/next-server",()=>({getInternalContext:deps.context}));
vi.mock("../repositories/goal-repository",()=>({GoalRepository:class{}}));
vi.mock("../services/goal-service",()=>({GoalService:class{save=deps.save;complete=deps.complete;list=deps.list;}}));
const actor={id:"synthetic-actor"};
beforeEach(()=>{vi.resetAllMocks();deps.context.mockResolvedValue({client:{},actor});});
describe("Goal server actions",()=>{
  it("keeps framework authentication redirects outside the error wrapper",async()=>{
    const redirect=new Error("NEXT_REDIRECT");deps.context.mockRejectedValue(redirect);
    await expect(saveGoalAction(null,{},null)).rejects.toBe(redirect);
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("passes the verified actor and invalidates only Goals after a confirmed save",async()=>{
    const goal={id:"synthetic-goal"};deps.save.mockResolvedValue(goal);
    expect(await saveGoalAction(null,{title:"Office"},null)).toEqual({ok:true,goal});
    expect(deps.save).toHaveBeenCalledWith(null,{title:"Office"},null,actor);
    expect(deps.revalidate.mock.calls).toEqual([["/team/goals"],["/team/goals/synthetic-goal"]]);
  });
  it("does not invalidate or report success after a database denial",async()=>{
    deps.complete.mockRejectedValue(new PermissionDeniedError());
    const result=await completeGoalMilestoneAction("goal","milestone",true);
    expect(result.ok).toBe(false);expect(deps.revalidate).not.toHaveBeenCalled();
  });
  it("keeps load-more failures recoverable without leaking provider messages",async()=>{
    deps.list.mockRejectedValue(new Error("private provider detail"));
    expect(await listGoalsAction("cursor")).toEqual({ok:false,error:"The operation failed."});
  });
  it("forwards a visibility filter with a fresh first-page cursor",async()=>{
    deps.list.mockResolvedValue({items:[],next_before:null});
    expect((await listGoalsAction(null,"leadership")).ok).toBe(true);
    expect(deps.list).toHaveBeenCalledWith(null,"leadership");
  });
});

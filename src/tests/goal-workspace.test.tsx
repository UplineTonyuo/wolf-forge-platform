/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalListView, GoalDetailView } from "../components/goals/goal-workspace";
import type { Goal } from "../domain/goals/schema";
const actions=vi.hoisted(()=>({complete:vi.fn(),refresh:vi.fn(),list:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:actions.refresh,push:vi.fn()})}));
vi.mock("../app/actions/goals",()=>({completeGoalMilestoneAction:actions.complete,listGoalsAction:actions.list,saveGoalAction:vi.fn()}));
const goal:Goal={id:"a0000000-0000-4000-8000-000000000002",title:"New workspace",description:"Work comfortably",owner_profile_id:"a0000000-0000-4000-8000-000000000001",owner_name:"Synthetic owner",due_date:"2026-11-30",visibility:"shared",created_at:"2026-11-01T00:00:00Z",updated_at:"2026-11-01T00:00:00Z",photo_path:null,photo_mime:null,photo_size:null,photo_checksum:null,milestone_count:2,completed_count:0,milestones:[{id:"a0000000-0000-4000-8000-000000000003",title:"Choose desks",completed_at:null},{id:"a0000000-0000-4000-8000-000000000004",title:"Install internet",completed_at:null}]};
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe("Goals workspace",()=>{
  it("shows shared cards to staff without management or private goals",()=>{
    render(<GoalListView initial={{items:[goal,{...goal,id:"a0000000-0000-4000-8000-000000000005",title:"Private plan",visibility:"leadership"}],next_before:null}} role="staff" actorId={goal.owner_profile_id} members={[]}/>);
    expect(screen.getByText("New workspace")).toBeTruthy();
    expect(screen.queryByText("Private plan")).toBeNull();expect(screen.queryByRole("button",{name:"New goal"})).toBeNull();
  });
  it("uses confirmed milestone results for progress",async()=>{
    actions.complete.mockResolvedValue({ok:true,goal:{...goal,completed_count:1,milestones:[{...goal.milestones[0],completed_at:"2026-11-01T01:00:00Z"},goal.milestones[1]]}});
    render(<GoalDetailView initial={goal} role="staff" actorId={goal.owner_profile_id} members={[]}/>);
    fireEvent.click(screen.getByRole("checkbox",{name:"Choose desks"}));
    await waitFor(()=>expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50"));
    expect(actions.complete).toHaveBeenCalledWith(goal.id,goal.milestones[0]!.id,true);
  });
  it("leaves unassigned milestones read-only",()=>{
    render(<GoalDetailView initial={goal} role="manager" actorId="a0000000-0000-4000-8000-000000000009" members={[]}/>);
    expect((screen.getByRole("checkbox",{name:"Choose desks"}) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button",{name:"Edit goal"})).toBeNull();
  });
  it("keeps progress intact after a refused update and allows retry",async()=>{
    actions.complete.mockResolvedValue({ok:false,error:"Unable to update this milestone."});
    render(<GoalDetailView initial={goal} role="staff" actorId={goal.owner_profile_id} members={[]}/>);
    fireEvent.click(screen.getByRole("checkbox",{name:"Choose desks"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Unable"));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect((screen.getByRole("checkbox",{name:"Choose desks"}) as HTMLInputElement).disabled).toBe(false);
  });
  it("shows a photo failure when an edit returns to the same detail route",()=>{
    const {rerender}=render(<GoalDetailView initial={goal} role="owner" actorId={goal.owner_profile_id} members={[]}/>);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<GoalDetailView initial={goal} role="owner" actorId={goal.owner_profile_id} members={[]} photoRetry/>);
    expect(screen.getByRole("alert").textContent).toContain("photo could not be uploaded");
  });
});

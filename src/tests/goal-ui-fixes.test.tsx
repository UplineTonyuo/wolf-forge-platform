/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalListView, GoalDetailView } from "../components/goals/goal-workspace";
import { GoalEditor } from "../components/goals/goal-editor";
import type { Goal, GoalMember } from "../domain/goals/schema";
const actions=vi.hoisted(()=>({complete:vi.fn(),list:vi.fn(),save:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:actions.refresh,push:vi.fn(),replace:vi.fn()})}));
vi.mock("../app/actions/goals",()=>({completeGoalMilestoneAction:actions.complete,listGoalsAction:actions.list,saveGoalAction:actions.save}));
vi.mock("../components/ui/animated-select",()=>({AnimatedSelect:({label,value,options,onChange,invalid,describedBy}:{label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void;invalid?:boolean;describedBy?:string})=><select aria-label={label} value={value} aria-invalid={invalid||undefined} aria-describedby={describedBy} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
vi.mock("../components/ui/date-picker",()=>({DatePicker:({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void})=><input aria-label={label} value={value} onChange={event=>onChange(event.target.value)}/> }));
const owner="a0000000-0000-4000-8000-000000000001",staff="a0000000-0000-4000-8000-000000000002";
const members:GoalMember[]=[{id:owner,display_name:"Owner test",role:"owner"},{id:staff,display_name:"Staff test",role:"staff"}];
const goal:Goal={id:"a0000000-0000-4000-8000-000000000003",title:"Office goal",description:"Synthetic only",owner_profile_id:staff,owner_name:"Staff test",due_date:"2026-11-30",visibility:"shared",created_at:"2026-11-01T00:00:00Z",updated_at:"2026-11-01T00:00:00Z",photo_path:null,photo_mime:null,photo_size:null,photo_checksum:null,completed_count:0,milestone_count:1,milestones:[{id:"a0000000-0000-4000-8000-000000000004",title:"Choose office",completed_at:null}]};
beforeEach(()=>{
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn(()=>"blob:goal-preview")});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});

describe("Goals UI regression fixes",()=>{
  it("loads the next page from the shared team collection",async()=>{
    const nextGoal={...goal,id:"a0000000-0000-4000-8000-000000000099",title:"Next team goal"};
    actions.list.mockResolvedValue({ok:true,data:{items:[nextGoal],next_before:null}});
    render(<GoalListView initial={{items:[goal],next_before:goal.id}} role="owner" actorId={owner} members={members}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load more goals"}));
    await waitFor(()=>expect(actions.list).toHaveBeenCalledWith(goal.id,null));
    expect(await screen.findByText("Next team goal")).toBeTruthy();
    expect(screen.getByText("Office goal")).toBeTruthy();
  });

  it("exposes a saving state while preserving authoritative milestone progress",async()=>{
    let resolve!:(value:unknown)=>void;
    actions.complete.mockReturnValue(new Promise(value=>{resolve=value;}));
    render(<GoalDetailView initial={goal} role="staff" actorId={staff} members={[]}/>);
    fireEvent.click(screen.getByRole("checkbox",{name:"Choose office"}));
    const box=screen.getByRole("checkbox",{name:"Choose office"}) as HTMLInputElement;
    expect(box.disabled).toBe(true);expect(box.checked).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Saving progress");
    await act(async()=>resolve({ok:false,error:"Synthetic refusal"}));
    expect(box.checked).toBe(false);expect(box.disabled).toBe(false);
  });

  it("protects unsaved work on close and discards only after confirmation",async()=>{
    render(<GoalListView initial={{items:[],next_before:null}} role="owner" actorId={owner} members={members}/>);
    fireEvent.click(screen.getByRole("button",{name:"New goal"}));
    fireEvent.change(await screen.findByLabelText("Goal title"),{target:{value:"Unsaved important goal"}});
    fireEvent.click(screen.getByRole("button",{name:"Close goal editor"}));
    expect(await screen.findByRole("dialog",{name:"Discard unsaved changes?"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
    expect((await screen.findByLabelText("Goal title") as HTMLInputElement).value).toBe("Unsaved important goal");
    fireEvent.click(screen.getByRole("button",{name:"Close goal editor"}));
    fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("keeps the selected assignee without a redundant visibility control",async()=>{
    render(<GoalEditor goal={goal} members={members} actorId={owner} onClose={()=>undefined}/>);
    expect(await screen.findByLabelText("Goal owner")).toBeTruthy();
    expect(screen.queryByLabelText("Goal visibility")).toBeNull();
    expect((screen.getByLabelText("Goal owner") as HTMLSelectElement).value).toBe(staff);
    expect(screen.getByText(/1080 × 1080/)).toBeTruthy();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("previews a chosen photo and lets it be removed without clearing the form",async()=>{
    render(<GoalEditor members={members} actorId={owner} onClose={()=>undefined}/>);
    fireEvent.change(await screen.findByLabelText("Goal title"),{target:{value:"Keep this goal"}});
    const dialog=screen.getByRole("dialog"), input=dialog.querySelector('input[type="file"]')!;
    fireEvent.change(input,{target:{files:[new File([new Uint8Array([0x89,0x50,0x4e,0x47])],"goal.png",{type:"image/png"})]}});
    expect(await screen.findByAltText("Selected goal photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Remove selected photo"}));
    expect(screen.queryByAltText("Selected goal photo")).toBeNull();
    expect((screen.getByLabelText("Goal title") as HTMLInputElement).value).toBe("Keep this goal");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:goal-preview");
  });

  it("identifies and focuses an invalid title",async()=>{
    render(<GoalEditor members={members} actorId={owner} onClose={()=>undefined}/>);
    const title=await screen.findByLabelText("Goal title");
    fireEvent.change(title,{target:{value:"   "}});
    screen.getByRole("button",{name:"Add milestone"}).focus();
    fireEvent.submit(title.closest("form")!);
    await waitFor(()=>expect(title.getAttribute("aria-invalid")).toBe("true"));
    expect(title.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(title);expect(actions.save).not.toHaveBeenCalled();
  });

  it("preserves the existing page after a failed load-more request",async()=>{
    actions.list.mockResolvedValue({ok:false,error:"Try again."});
    render(<GoalListView initial={{items:[goal],next_before:goal.id}} role="owner" actorId={owner} members={members}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load more goals"}));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No goals in this view")).toBeNull();
    expect(screen.getByText("Office goal")).toBeTruthy();
    expect(screen.getByRole("button",{name:"Load more goals"})).toBeTruthy();
  });
});

/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({list:vi.fn(),get:vi.fn(),save:vi.fn()}));
vi.mock("../app/actions/white-label", () => ({listWhiteLabelDraftsAction:actions.list,getWhiteLabelDraftAction:actions.get,saveWhiteLabelDraftAction:actions.save}));
vi.mock("next/navigation", () => ({usePathname:()=>"/white-label",useRouter:()=>({push:vi.fn()})}));
import { WhiteLabelDraftEditor } from "../components/white-label/white-label-draft-editor";
import { modulesFromKeys, type WhiteLabelDraftSummary } from "../domain/white-label/draft";
import { SYNTHETIC_PREVIEW_STATE } from "../domain/white-label/preview";
import { WhiteLabelService } from "../services/white-label-service";

const A="c70b73ea-99d9-4c1f-9b0c-f7087a724859", B="c70b73ea-99d9-4c1f-9b0c-f7087a724860", NEW="f0f0f0f0-0000-4000-8000-000000000001";
let rows: WhiteLabelDraftSummary[];
beforeEach(() => {
  vi.resetAllMocks(); window.history.replaceState(null,"","/white-label");
  rows=[A,B,NEW].map((id,index)=>({tenant:{id,slug:`tenant-${index}`,displayName:index===2?"Never saved Tenant":`Tenant ${index===0?"A":"B"}`,status:"active",draftRevision:index===2?null:3},draft:{tenantId:id,tenantStatus:"active",state:{...SYNTHETIC_PREVIEW_STATE,displayName:`Saved ${index}`,modules:{...SYNTHETIC_PREVIEW_STATE.modules}},revision:index===2?0:3,updatedAt:index===2?null:"2026-10-12T00:00:00.000Z"}}));
  actions.list.mockImplementation(async()=>({ok:true,data:structuredClone(rows)}));
  actions.get.mockImplementation(async(id:string)=>({ok:true,data:structuredClone(rows.find(row=>row.tenant.id===id)!.draft)}));
  actions.save.mockImplementation(async(input)=>{
    const row=rows.find(row=>row.tenant.id===input.tenantId)!;
    row.draft={...row.draft,state:{displayName:input.displayName,primaryColor:input.primaryColor,accentColor:input.accentColor,modules:modulesFromKeys(input.moduleKeys)},revision:row.draft.revision+1,updatedAt:"2026-10-12T01:00:00.000Z"};
    return {ok:true,data:{revision:row.draft.revision,updatedAt:row.draft.updatedAt}};
  });
});
afterEach(cleanup);
function mount() {render(<WhiteLabelDraftEditor tenants={rows.map(row=>row.tenant)} initialDraft={null}/>);}
async function open(name="Tenant A") {fireEvent.click(await screen.findByRole("button",{name:`Continue Editing ${name}`})); await screen.findByLabelText("Workspace display name");}
const input=()=>screen.getByLabelText("Workspace display name");
async function allDrafts() {fireEvent.click(screen.getByRole("button",{name:"All Drafts"})); await screen.findByRole("region",{name:"Tenant drafts"});}
describe("persistent Tenant draft manager",()=>{
  it("shows authoritative saved summaries and labels defaults without a fabricated saved time",async()=>{
    mount();const list=await screen.findByRole("region",{name:"Tenant drafts"});
    expect(within(list).getByText("Saved 0")).toBeInTheDocument();
    expect(within(list).getAllByText("Revision 3")).toHaveLength(2);
    const defaults=within(list).getByRole("button",{name:"Continue Editing Never saved Tenant"}).closest("li")!;
    expect(within(defaults).getByText("Never saved")).toBeInTheDocument(); expect(defaults.querySelector("time")).toBeNull();
    expect(list.querySelectorAll("time")).toHaveLength(2);
  });
  it("Continue Editing fresh-reads the requested persisted revision rather than trusting a summary",async()=>{
    mount();await screen.findByRole("region",{name:"Tenant drafts"});rows[0]!.draft.revision=8;rows[0]!.draft.state.displayName="Latest";
    await open();expect(actions.get).toHaveBeenCalledWith(A);expect(input()).toHaveValue("Latest");expect(screen.getByTestId("draft-revision")).toHaveTextContent("revision 8");
    expect(window.location.search).toBe(`?tenant=${A}`);
  });
  it("saves, returns and resumes A and B with separate persisted configurations",async()=>{
    mount();await open();fireEvent.change(input(),{target:{value:"Saved A change"}});
    fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save Draft, then return"})));
    await screen.findByRole("region",{name:"Tenant drafts"});expect(screen.getByText("Saved A change")).toBeInTheDocument();
    await open("Tenant B");expect(input()).toHaveValue("Saved 1");fireEvent.change(input(),{target:{value:"Saved B change"}});
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save Draft"})));await allDrafts();
    await open();expect(input()).toHaveValue("Saved A change");expect(rows[1]!.draft.state.displayName).toBe("Saved B change");expect(rows[0]!.draft.revision).toBe(4);expect(rows[1]!.draft.revision).toBe(4);
  });
  it("Stay retains unsaved edits and discard removes only local edits",async()=>{
    mount();await open();fireEvent.change(input(),{target:{value:"Unsaved A"}});fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));
    expect(screen.getByRole("dialog",{name:"Unsaved draft changes"})).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
    expect(input()).toHaveValue("Unsaved A");
    fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));fireEvent.click(screen.getByRole("button",{name:"Discard and return"}));
    await screen.findByRole("region",{name:"Tenant drafts"});await open();expect(input()).toHaveValue("Saved 0");expect(actions.save).not.toHaveBeenCalled();
  });
  it("a failed save-and-return retains editor state and the original retry payload",async()=>{
    actions.save.mockRejectedValueOnce(new TypeError("lost response"));mount();await open();fireEvent.change(input(),{target:{value:"Keep me"}});
    fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save Draft, then return"})));
    expect(screen.getByRole("dialog")).toBeInTheDocument();expect(input()).toHaveValue("Keep me");const original=actions.save.mock.calls[0]![0];
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save Draft, then return"})));expect(actions.save.mock.calls[1]![0]).toEqual(original);await screen.findByRole("region",{name:"Tenant drafts"});
  });
  it("retryable list errors offer retry; revoked access clears draft summaries",async()=>{
    actions.list.mockRejectedValueOnce(new TypeError("offline"));mount();await screen.findByText("Drafts could not be loaded");
    fireEvent.click(screen.getByRole("button",{name:"Try again"}));await open();
    actions.list.mockResolvedValueOnce({ok:false,error:{code:"PERMISSION_DENIED",message:"denied"}});fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));
    await screen.findByText("Drafts unavailable");expect(screen.queryByText("Saved 0")).toBeNull();expect(screen.queryByLabelText("Workspace display name")).toBeNull();
  });
  it("Back with unsaved work requests confirmation; Stay restores editor URL and Forward resumes persisted state",async()=>{
    mount();await open();fireEvent.change(input(),{target:{value:"Unsaved Back"}});
    await act(async()=>{window.history.back();});await screen.findByRole("dialog",{name:"Unsaved draft changes"});
    await waitFor(()=>expect(window.location.search).toBe(`?tenant=${A}`));fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));expect(input()).toHaveValue("Unsaved Back");
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    await act(async()=>window.history.back());await screen.findByRole("dialog");fireEvent.click(screen.getByRole("button",{name:"Discard and return"}));await screen.findByRole("region",{name:"Tenant drafts"});
    await act(async()=>window.history.forward());await screen.findByLabelText("Workspace display name");expect(input()).toHaveValue("Saved 0");
  });
  it("Escape during Save-and-return does not cancel the destination of an accepted save",async()=>{
    let finish!: (value:unknown)=>void;actions.save.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));mount();await open();fireEvent.change(input(),{target:{value:"Deferred save"}});
    fireEvent.click(screen.getByRole("button",{name:"All Drafts"}));fireEvent.click(screen.getByRole("button",{name:"Save Draft, then return"}));fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.getByRole("dialog")).toBeInTheDocument();expect(input()).toHaveValue("Deferred save");
    rows[0]!.draft.state.displayName="Deferred save";rows[0]!.draft.revision=4;
    await act(async()=>finish({ok:true,data:{revision:4,updatedAt:"2026-10-12T01:00:00.000Z"}}));await screen.findByRole("region",{name:"Tenant drafts"});
  });
  it("same-document Back outside Studio is intercepted before the router can discard edits",async()=>{
    window.history.replaceState({wfStudioIndex:0},"","/dashboard");window.history.pushState({wfStudioIndex:1},"",`/white-label?tenant=${A}`);
    render(<WhiteLabelDraftEditor tenants={rows.map(row=>row.tenant)} initialDraft={rows[0]!.draft}/>);fireEvent.change(input(),{target:{value:"Do not lose"}});
    await act(async()=>window.history.back());await screen.findByText(/Leaving this studio discards/);await waitFor(()=>expect(window.location.pathname).toBe("/white-label"));
    fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));expect(input()).toHaveValue("Do not lose");expect(actions.save).not.toHaveBeenCalled();
  });
  it("same-Tenant fragment history preserves unsaved edits instead of reloading a draft",async()=>{
    mount();await open();fireEvent.change(input(),{target:{value:"Unsaved jump"}});actions.get.mockClear();
    window.history.pushState({...window.history.state},"",`/white-label?tenant=${A}#preview`);
    await act(async()=>window.history.back());await waitFor(()=>expect(window.location.hash).toBe(""));
    expect(input()).toHaveValue("Unsaved jump");expect(actions.get).not.toHaveBeenCalled();expect(screen.queryByRole("dialog")).toBeNull();
  });
});
describe("draft summary projection",()=>{
  it("uses authorized discovery and existing draft reads; refuses partial summaries when a read is denied",async()=>{
    const repository={listTenants:vi.fn(async()=>rows.map(row=>row.tenant)),getDraft:vi.fn(async(id:string)=>rows.find(row=>row.tenant.id===id)!.draft)};
    const service=new WhiteLabelService({repository} as never);expect(await service.listDrafts()).toHaveLength(3);
    expect(repository.getDraft.mock.calls.map(call=>call[0])).toEqual([A,B,NEW]);repository.getDraft.mockRejectedValueOnce(new Error("denied"));await expect(service.listDrafts()).rejects.toThrow("denied");
  });
});

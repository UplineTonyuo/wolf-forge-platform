import {beforeEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({context:vi.fn(),assign:vi.fn(),module:vi.fn(),revalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:f.revalidate}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getInternalContext:f.context}));
import {bulkAssignClientManagerAction} from "../app/actions/clients";
const first="71000000-0000-4000-8000-000000000001",second="71000000-0000-4000-8000-000000000002",manager="71000000-0000-4000-8000-000000000003";
const context=()=>({user:{clients:{edit:true}},actor:{},services:{permissions:{requireModuleAccess:f.module},companies:{assignManager:f.assign,listActive:async()=>[{id:first,name:"First synthetic account"},{id:second,name:"Second synthetic account"}]}}});
beforeEach(()=>{vi.resetAllMocks();f.context.mockResolvedValue(context());f.assign.mockResolvedValue(undefined);});
it("rejects invalid and oversized selection before resolving identity",async()=>{
 expect((await bulkAssignClientManagerAction([first],"invalid")).succeeded).toEqual([]);
 expect((await bulkAssignClientManagerAction(Array.from({length:101},()=>first),manager)).succeeded).toEqual([]);
 expect(f.context).not.toHaveBeenCalled();expect(f.assign).not.toHaveBeenCalled();
});
it("requires edit permission and module access before any assignment",async()=>{
 const denied=context();denied.user.clients.edit=false;f.context.mockResolvedValue(denied);
 expect((await bulkAssignClientManagerAction([first],manager)).failed).toHaveLength(1);expect(f.assign).not.toHaveBeenCalled();
 f.context.mockResolvedValue(context());f.module.mockRejectedValue(new Error("Disabled"));
 expect((await bulkAssignClientManagerAction([first],manager)).failed).toHaveLength(1);expect(f.assign).not.toHaveBeenCalled();
});
it("keeps per-account failures honest and refreshes authoritative successes",async()=>{
 f.assign.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Synthetic denied"));
 const result=await bulkAssignClientManagerAction([first,first,second],manager);
 expect(result.attempted).toBe(2);expect(result.succeeded.map(row=>row.id)).toEqual([first]);expect(result.failed.map(row=>row.id)).toEqual([second]);
 expect(f.assign.mock.calls.map(call=>call.slice(0,2))).toEqual([[first,manager],[second,manager]]);
 expect(f.revalidate).toHaveBeenCalledWith("/clients");expect(f.revalidate).toHaveBeenCalledWith(`/clients/${first}`);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";
const id = '10000000-0000-4000-8000-000000000001', taskId = '10000000-0000-4000-8000-000000000002';
const mocks = vi.hoisted(() => ({ context: vi.fn(), module: vi.fn(), order: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), assign: vi.fn(), revalidate: vi.fn() }));
vi.mock('../lib/supabase/next-server', () => ({getInternalContext:mocks.context}));
vi.mock('next/cache', () => ({revalidatePath:mocks.revalidate}));
const { manageProjectTaskAction } = await import('../app/actions/project-tasks');
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.order.mockResolvedValue({id,archived_at:null});mocks.get.mockResolvedValue({id:taskId,order_id:id,archived_at:null});
 mocks.context.mockResolvedValue({actor:{id},user:{projects:{edit:true,assign:true}},services:{permissions:{requireModuleAccess:mocks.module},orders:{get:mocks.order},tasks:{get:mocks.get,create:mocks.create,update:mocks.update,changeStatus:mocks.status,assign:mocks.assign}}});
});
describe('project task actions',()=>{
 it('checks the module before reading or mutating task data',async()=>{
  mocks.module.mockRejectedValue(new PermissionDeniedError());expect((await manageProjectTaskAction(id,{kind:'status',taskId,status:'complete'})).ok).toBe(false);
  expect(mocks.order).not.toHaveBeenCalled();expect(mocks.status).not.toHaveBeenCalled();
 });
 it.each([{edit:false,assign:true},{edit:true,assign:false}])('requires edit AND assign for task assignment: %j',async(caps)=>{
  const context=await mocks.context();context.user.projects=caps;
  expect((await manageProjectTaskAction(id,{kind:'assign',taskId,profileId:id})).ok).toBe(false);expect(mocks.assign).not.toHaveBeenCalled();expect(mocks.get).not.toHaveBeenCalled();
 });
 it('refuses a task belonging to a different project',async()=>{
  mocks.get.mockResolvedValue({id:taskId,order_id:taskId,archived_at:null});
  expect((await manageProjectTaskAction(id,{kind:'rename',taskId,title:'Changed'})).ok).toBe(false);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('refuses archived project or task mutations',async()=>{
  mocks.order.mockResolvedValue({id,archived_at:'2026-10-30T00:00:00Z'});expect((await manageProjectTaskAction(id,{kind:'status',taskId,status:'complete'})).ok).toBe(false);
  expect(mocks.status).not.toHaveBeenCalled();
 });
 it('preserves the create request ID for safe retry and uses the verified actor',async()=>{
  expect(await manageProjectTaskAction(id,{kind:'create',title:' QA task ',requestId:taskId})).toEqual({ok:true});
  expect(mocks.create).toHaveBeenCalledWith({order_id:id,title:'QA task',request_id:taskId},{id});
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${id}`);
  expect(mocks.revalidate).toHaveBeenCalledWith(`/account/projects/${id}`);
  expect(mocks.revalidate).toHaveBeenCalledWith('/account/projects');
  expect(mocks.revalidate).toHaveBeenCalledWith('/account');
 });
 it('lets the database reject a stale or invalid assignment without claiming success',async()=>{
  mocks.assign.mockRejectedValue(new PermissionDeniedError());
  expect((await manageProjectTaskAction(id,{kind:'assign',taskId,profileId:id})).ok).toBe(false);expect(mocks.revalidate).not.toHaveBeenCalled();
 });
});

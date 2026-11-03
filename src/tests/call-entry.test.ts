import { expect,it } from "vitest";
import { callEntryPath,callConversationPath } from "../domain/tickets/call-entry";
import { safeAccountNextPath } from "../domain/auth/safe-next-path";
const id="71000000-0000-4000-8000-000000000001";
it("resolves only bounded UUID call entries and safe authenticated client return",()=>{
 expect(callEntryPath(id)).toBe(`/calls/${id}`);expect(callEntryPath("../account")).toBeNull();expect(safeAccountNextPath(`/calls/${id}`)).toBe(`/calls/${id}`);
 expect(safeAccountNextPath(`/calls/${id}?next=https://bad.example`)).toBe("/account");
 expect(safeAccountNextPath(`//bad.example/calls/${id}`)).toBe("/account");
 expect(callConversationPath("client",id,id)).toBe(`/account/messages/${id}?call=${id}`);
});

import { expect,it,vi } from "vitest";
import { CallMedia } from "../components/calls/call-media";
it("a cancelled SDK import never creates a call object or acquires devices",async()=>{
 let release!:(value:never)=>void; const factory=vi.fn();
 const media=new CallMedia(vi.fn(),()=>new Promise(r=>{release=r;}));
 const pending=media.join({token:"a.b.c",roomUrl:"https://wolfforge.daily.co/wf-call-71000000-0000-4000-8000-000000000001",mode:"audio"},"peer");
 media.stop();release({createCallObject:factory} as never);await pending;expect(factory).not.toHaveBeenCalled();
});
it("voice joins without a camera and destroys stale media after late completion",async()=>{
 let complete!:()=>void;const call={join:vi.fn(()=>new Promise<void>(r=>{complete=r;})),on:vi.fn(),destroy:vi.fn().mockResolvedValue(undefined)};
 const create=vi.fn(()=>call);const media=new CallMedia(vi.fn(),async()=>({createCallObject:create}) as never);
 const pending=media.join({token:"a.b.c",roomUrl:"https://wolfforge.daily.co/wf-call-71000000-0000-4000-8000-000000000001",mode:"audio"},"peer");
 await vi.waitFor(()=>expect(call.join).toHaveBeenCalled());media.stop();complete();await pending;
 expect(create).toHaveBeenCalledWith(expect.objectContaining({videoSource:false,startVideoOff:true}));expect(call.destroy).toHaveBeenCalled();
});

import { expect,it,vi } from "vitest";
import { LocalCallPreview } from "../components/calls/call-preview";
it("cancel stops a late permission result without retaining a track",async()=>{
 const stop=vi.fn();let resolve!:(s:MediaStream)=>void;const get=vi.fn(()=>new Promise<MediaStream>(r=>{resolve=r;}));const preview=new LocalCallPreview(get);
 const pending=preview.start("audio");preview.stop();resolve({getTracks:()=>[{stop}]} as unknown as MediaStream);expect(await pending).toBeNull();expect(stop).toHaveBeenCalled();
});
it("voice preview never requests a video device",async()=>{
 const get=vi.fn().mockResolvedValue({getTracks:()=>[]});const preview=new LocalCallPreview(get);await preview.start("audio");expect(get).toHaveBeenCalledWith({audio:true,video:false});preview.stop();
});

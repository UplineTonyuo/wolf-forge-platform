/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { connectCallSignals } from "../components/calls/call-signals";
class Source {
 static CLOSED=2;static sources:Source[]=[];readyState=1;onerror:(()=>void)|null=null;listeners=new Map<string,()=>void>();close=vi.fn();
 constructor(){Source.sources.push(this);}addEventListener(name:string,fn:()=>void){this.listeners.set(name,fn);}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();Source.sources=[];});
it("coalesces duplicate broadcasts through one connection without recurring call reads",async()=>{
 vi.stubGlobal("EventSource",Source);vi.useFakeTimers();let resolve!:()=>void;
 const wake=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{resolve=r;})).mockResolvedValue(null);
 const stop=connectCallSignals(wake);const source=Source.sources[0]!;source.listeners.get("wake")!();source.listeners.get("wake")!();source.listeners.get("wake")!();expect(wake).toHaveBeenCalledOnce();
 resolve();await vi.advanceTimersByTimeAsync(60000);expect(wake).toHaveBeenCalledTimes(2);expect(Source.sources).toHaveLength(1);
 stop();expect(source.close).toHaveBeenCalledOnce();window.dispatchEvent(new Event("online"));expect(Source.sources).toHaveLength(1);
});
it("stops disabled subscriptions instead of retrying or polling",async()=>{
 vi.stubGlobal("EventSource",Source);vi.useFakeTimers();const wake=vi.fn();const stop=connectCallSignals(wake);
 Source.sources[0]!.listeners.get("disabled")!();await vi.advanceTimersByTimeAsync(300000);
 expect(Source.sources).toHaveLength(1);expect(wake).not.toHaveBeenCalled();stop();
});
it("retries a transient failed HTTP open even when EventSource reports CLOSED",async()=>{
 vi.stubGlobal("EventSource",Source);vi.useFakeTimers();const stop=connectCallSignals(vi.fn());
 Source.sources[0]!.readyState=Source.CLOSED;Source.sources[0]!.onerror!();await vi.advanceTimersByTimeAsync(10000);
 expect(Source.sources).toHaveLength(2);stop();
});

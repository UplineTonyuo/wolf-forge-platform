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

it("recovers after more than six failed opens with one capped-backoff connection",async()=>{
 vi.stubGlobal("EventSource",Source);vi.useFakeTimers();const wake=vi.fn().mockResolvedValue(null);const stop=connectCallSignals(wake);
 try{
  for(const delay of [10000,20000,40000,60000,60000,60000,60000]){
   const count=Source.sources.length;const source=Source.sources.at(-1)!;source.onerror!();source.onerror!();
   expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(delay-1);expect(Source.sources).toHaveLength(count);
   await vi.advanceTimersByTimeAsync(1);expect(Source.sources).toHaveLength(count+1);expect(source.close).toHaveBeenCalledOnce();
  }
  Source.sources.at(-1)!.listeners.get("wake")!();await vi.advanceTimersByTimeAsync(60000);
  expect(wake).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);expect(Source.sources).toHaveLength(8);
 }finally{stop();}
});

it.each(["hidden","offline","disposed","disabled"])("cancels a pending reconnect when %s",async reason=>{
 vi.stubGlobal("EventSource",Source);vi.useFakeTimers();const wake=vi.fn();const stop=connectCallSignals(wake);
 try{
  const source=Source.sources[0]!;source.onerror!();expect(vi.getTimerCount()).toBe(1);
  if(reason==="hidden"){vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");document.dispatchEvent(new Event("visibilitychange"));}
  if(reason==="offline"){vi.spyOn(navigator,"onLine","get").mockReturnValue(false);window.dispatchEvent(new Event("offline"));}
  if(reason==="disposed")stop();
  if(reason==="disabled"){await vi.advanceTimersByTimeAsync(10000);Source.sources.at(-1)!.listeners.get("disabled")!();}
  const count=Source.sources.length;await vi.advanceTimersByTimeAsync(300000);
  expect(vi.getTimerCount()).toBe(0);expect(Source.sources).toHaveLength(count);expect(wake).not.toHaveBeenCalled();
 }finally{stop();vi.restoreAllMocks();}
});

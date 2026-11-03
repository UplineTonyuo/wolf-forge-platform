/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { startCallRingtone } from "../components/calls/call-ringtone";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("reports autoplay blocking, resumes on a gesture and stops every ring on cleanup",async()=>{
 vi.useFakeTimers();const start=vi.fn(),close=vi.fn(async()=>{});
 const context={state:"suspended",currentTime:0,destination:{},resume:vi.fn(async()=>{}),close,
  createOscillator:()=>({frequency:{value:0},connect:vi.fn(),start,stop:vi.fn()}),
  createGain:()=>({gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn()})};
 vi.stubGlobal("AudioContext",class {constructor(){return context;}});
 const blocked=vi.fn();const ring=startCallRingtone(Date.now()+40000,blocked);await Promise.resolve();
 expect(blocked).toHaveBeenCalledWith(true);expect(start).not.toHaveBeenCalled();
 context.state="running";ring.resume();await Promise.resolve();expect(start).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(3000);expect(start).toHaveBeenCalledTimes(2);
 ring.stop();await vi.advanceTimersByTimeAsync(50000);expect(start).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledOnce();
});
it("cannot start a late resume after cancellation or ring beyond the authoritative deadline",async()=>{
 vi.useFakeTimers();let finish!:()=>void;const start=vi.fn();
 const context={state:"running",currentTime:0,destination:{},resume:()=>new Promise<void>(r=>{finish=r;}),close:async()=>{},
  createOscillator:()=>({frequency:{value:0},connect:vi.fn(),start,stop:vi.fn()}),createGain:()=>({gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn()})};
 vi.stubGlobal("AudioContext",class {constructor(){return context;}});
 const ring=startCallRingtone(Date.now()+1000,vi.fn());ring.stop();finish();await vi.advanceTimersByTimeAsync(6000);expect(start).not.toHaveBeenCalled();
});

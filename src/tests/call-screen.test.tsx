/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
vi.mock("../components/account/ui/portal-dialog",()=>({PortalDialog:({children,open,title}:{children:React.ReactNode;open:boolean;title:string})=>open?<div role="dialog" aria-label={title}>{children}</div>:null}));
import { CallScreen } from "../components/calls/call-screen";
import { placeCallWindow } from "../components/calls/floating-call-window";
import { emptyMedia } from "../components/calls/call-media";
import type { CallController,CallState } from "../components/calls/call-controller";
import type { CallMedia } from "../components/calls/call-media";
const id="71000000-0000-4000-8000-000000000001",other="71000000-0000-4000-8000-000000000002";
const call={id,ticketId:id,callerId:other,calleeId:id,mode:"audio",state:"ringing",expiresAt:"2026-11-03T12:15:00Z"} as CallState["call"];
const state={call,peer:{name:"Synthetic client",avatarUrl:null},busy:false,error:"",minimized:false,canJoin:false,joinAttempt:0};
const command=vi.fn();const controller={profileId:id,command,close:vi.fn(),minimize:vi.fn(),end:vi.fn(),allowJoin:vi.fn()} as unknown as CallController;
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it("offers answer and decline with camera-free voice presentation",()=>{render(<CallScreen state={state} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={0}/>);
 expect(screen.getByText("Voice only · Camera stays off")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Answer"}));expect(command).toHaveBeenCalledWith("accept");expect(screen.queryByRole("button",{name:"Turn camera on"})).not.toBeInTheDocument();
});
it("a minimized ongoing call keeps an accessible reopen control",()=>{render(<CallScreen state={{...state,call:{...state.call!,state:"active"},minimized:true}} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={0}/>);expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:/Synthetic client/})).toBeInTheDocument();});
it("keeps audio recovery inside the modal and the countdown outside the live region",()=>{render(<CallScreen state={state} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={0} playBlocked onPlay={vi.fn()}/>);
 expect(screen.getByRole("dialog")).toContainElement(screen.getByRole("button",{name:"Tap to hear the call"}));expect(screen.getByRole("status")).not.toHaveTextContent("left");
});

async function openDevices(devices:Partial<MediaDeviceInfo>[],supportsOutput=true){
 vi.stubGlobal("navigator",{mediaDevices:{enumerateDevices:vi.fn().mockResolvedValue(devices)}});
 vi.stubGlobal("HTMLMediaElement",supportsOutput?class{setSinkId(){}}:class{});
 const device=vi.fn().mockResolvedValue(true);
 render(<CallScreen state={{...state,call:{...call!,state:"active"}}} controller={controller} media={{device} as unknown as CallMedia} mediaState={{...emptyMedia,state:"connected"}} now={0}/>);
 const details=screen.getByText("Device settings").closest("details")!;
 await act(async()=>{details.open=true;fireEvent(details,new Event("toggle"));});
 return device;
}
it("returns to the enumerated system speaker using its valid ID",async()=>{
 const device=await openDevices([{kind:"audiooutput",deviceId:"default",label:"Default speakers"},{kind:"audiooutput",deviceId:"headset",label:"Headset"}]);
 fireEvent.keyDown(screen.getByRole("button",{name:/^Speaker:/}),{key:"ArrowDown"});fireEvent.click(screen.getByRole("option",{name:"Headset"}));
 await waitFor(()=>expect(device).toHaveBeenCalledWith("audiooutput","headset"));
 await waitFor(()=>expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
 fireEvent.keyDown(screen.getByRole("button",{name:/^Speaker:/}),{key:"ArrowDown"});fireEvent.click(screen.getByRole("option",{name:"System speaker"}));
 await waitFor(()=>expect(device).toHaveBeenLastCalledWith("audiooutput","default"));
});
it("omits the synthetic default speaker when no valid default ID is enumerated",async()=>{
 await openDevices([{kind:"audiooutput",deviceId:"headset",label:"Headset"},{kind:"audiooutput",deviceId:"",label:"Unavailable"}]);
 fireEvent.keyDown(screen.getByRole("button",{name:/^Speaker:/}),{key:"ArrowDown"});
 expect(screen.queryByRole("option",{name:"System speaker"})).not.toBeInTheDocument();
 expect(screen.queryByRole("option",{name:"Unavailable"})).not.toBeInTheDocument();
 expect(screen.getByRole("option",{name:"Headset"})).toBeInTheDocument();
});
it("hides speaker selection when the browser cannot select an output device",async()=>{
 await openDevices([{kind:"audiooutput",deviceId:"default",label:"Default speakers"}],false);
 expect(screen.queryByRole("button",{name:/^Speaker:/})).not.toBeInTheDocument();
});

const activeVideo={...state,call:{...call!,mode:"video" as const,state:"active" as const},minimized:true};
function showVideo(overrides:Partial<Parameters<typeof CallScreen>[0]>={}){
 return render(<CallScreen state={activeVideo} controller={controller} media={{mic:vi.fn()} as unknown as CallMedia} mediaState={{...emptyMedia,state:"connected",micOn:true}} now={0} {...overrides}/>);
}
it("shows the remote video and three call controls while a video call is minimized",()=>{
 const track={kind:"video"} as MediaStreamTrack;
 const stream={getTracks:()=>[track]};
 vi.stubGlobal("MediaStream",class{constructor(tracks:MediaStreamTrack[]){expect(tracks).toEqual([track]);return stream;}});
 vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
 showVideo({mediaState:{...emptyMedia,state:"connected",micOn:true,remoteVideo:track}});
 const window=screen.getByRole("region",{name:"Floating video call"});
 expect(window).toContainElement(screen.getByLabelText("Participant camera"));
 expect((screen.getByLabelText("Participant camera") as HTMLVideoElement).srcObject).toBe(stream);
 expect(window).toHaveTextContent("Synthetic client");expect(window).toHaveTextContent("15:00");
 expect(screen.getByRole("button",{name:"Mute microphone"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"End call"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Reopen call with Synthetic client"})).toBeInTheDocument();
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps the original strip for minimized audio calls",()=>{
 render(<CallScreen state={{...activeVideo,call:{...call!,state:"active"}}} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={0}/>);
 expect(screen.queryByRole("region",{name:"Floating video call"})).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:/Synthetic client.*Waiting for the other person.*15:00/})).toBeInTheDocument();
});
it("expands the floating call through the controller",()=>{showVideo();fireEvent.click(screen.getByRole("button",{name:"Reopen call with Synthetic client"}));expect(controller.minimize).toHaveBeenCalledWith(false);});
it("reopens the full call by clicking the floating video",()=>{showVideo();fireEvent.click(screen.getByRole("button",{name:"View full video call with Synthetic client"}));expect(controller.minimize).toHaveBeenCalledWith(false);});
it("ends the floating call through the controller",()=>{showVideo();fireEvent.click(screen.getByRole("button",{name:"End call"}));expect(controller.end).toHaveBeenCalledOnce();});
it("toggles the microphone and labels its muted state",()=>{
 const mic=vi.fn();const view=showVideo({media:{mic} as unknown as CallMedia});
 fireEvent.click(screen.getByRole("button",{name:"Mute microphone"}));expect(mic).toHaveBeenCalledOnce();
 view.rerender(<CallScreen state={activeVideo} controller={controller} media={{mic} as unknown as CallMedia} mediaState={emptyMedia} now={0}/>);
 expect(screen.getByRole("button",{name:"Unmute microphone"})).toHaveAttribute("aria-pressed","true");
});
it("shows the participant portrait when their video is unavailable",()=>{showVideo();expect(screen.getByRole("region",{name:"Floating video call"})).toHaveTextContent("Sc");expect(screen.queryByLabelText("Participant camera")).not.toBeInTheDocument();});
it.each(["ended","ringing"] as const)("does not show a floating window for an %s incoming call",callState=>{showVideo({state:{...activeVideo,call:{...activeVideo.call,state:callState}}});expect(screen.queryByRole("region",{name:"Floating video call"})).not.toBeInTheDocument();});
it("keeps the chosen corner through updates and full-screen reopening during the same call",()=>{
 const view=showVideo();const move=screen.getByRole("button",{name:/Move call window/});
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","bottom-right");
 fireEvent.keyDown(move,{key:"ArrowLeft"});fireEvent.keyDown(move,{key:"ArrowUp"});
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","top-left");
 view.rerender(<CallScreen state={{...activeVideo,minimized:false}} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={1000}/>);
 view.rerender(<CallScreen state={activeVideo} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={2000}/>);
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","top-left");
 view.rerender(<CallScreen state={{...activeVideo,call:{...activeVideo.call,id:other}}} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={2000}/>);
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","bottom-right");
});

it("places the lower-right window above the composer and bottom navigation",()=>{
 expect(placeCallWindow("bottom-right",272,257,{left:0,top:0,right:390,bottom:844},[
  {left:0,top:600,right:390,bottom:788},{left:0,top:788,right:390,bottom:844}
 ])).toMatchObject({x:106,y:331});
});
it("keeps a left-corner window beside the desktop sidebar and below sticky actions",()=>{
 expect(placeCallWindow("top-left",272,257,{left:0,top:0,right:1440,bottom:900},[
  {left:0,top:0,right:252,bottom:900},{left:252,top:0,right:1440,bottom:72}
 ])).toMatchObject({x:264,y:84});
});
it.each(["top-left","top-right","bottom-left","bottom-right"] as const)("clamps %s into the visible viewport",corner=>{
 const point=placeCallWindow(corner,272,257,{left:10,top:30,right:330,bottom:670},[])!;
 expect(point.x).toBeGreaterThanOrEqual(22);expect(point.x+272).toBeLessThanOrEqual(318);
 expect(point.y).toBeGreaterThanOrEqual(42);expect(point.y+257).toBeLessThanOrEqual(658);
});
it.each(["mouse","touch"])("drags with %s capture and snaps to the nearest corner",pointerType=>{
 vi.stubGlobal("PointerEvent",class extends MouseEvent{pointerId=1;isPrimary=true;pointerType=pointerType;});
 const capture=vi.fn();HTMLElement.prototype.setPointerCapture=capture;
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
  if(this.getAttribute("role")==="region")return {left:Number.parseFloat(this.style.left)||0,top:Number.parseFloat(this.style.top)||0,width:272,height:257,right:272,bottom:257,x:0,y:0,toJSON(){}};
  return {left:0,top:0,right:0,bottom:0,width:0,height:0,x:0,y:0,toJSON(){}};
 });
 showVideo();const move=screen.getByRole("button",{name:/Move call window/});
 fireEvent.pointerDown(move,{button:0,clientX:800,clientY:500});expect(capture).toHaveBeenCalledWith(1);
 fireEvent.pointerMove(move,{clientX:-2000,clientY:-2000});
 const window=screen.getByRole("region",{name:"Floating video call"});
 expect(Number.parseFloat(window.style.left)).toBe(12);expect(Number.parseFloat(window.style.top)).toBe(12);
 fireEvent.pointerUp(move,{clientX:0,clientY:0});expect(window).toHaveAttribute("data-corner","top-left");
 expect(window).not.toHaveAttribute("data-dragging");
});
it("cancels a drag without changing its saved corner",()=>{
 vi.stubGlobal("PointerEvent",class extends MouseEvent{pointerId=1;isPrimary=true;});
 HTMLElement.prototype.setPointerCapture=vi.fn();showVideo();
 const move=screen.getByRole("button",{name:/Move call window/});
 fireEvent.pointerDown(move,{button:0,clientX:100,clientY:100});fireEvent.pointerCancel(move);
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","bottom-right");
 expect(screen.getByRole("region",{name:"Floating video call"})).not.toHaveAttribute("data-dragging");
});

it("moves to the next corner by tapping the move control without dragging",()=>{
 showVideo();fireEvent.click(screen.getByRole("button",{name:/Move call window/}));
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","bottom-left");
});

it("ignores a closed mobile backdrop when keeping the composer clear",()=>{
 vi.stubGlobal("innerWidth",390);vi.stubGlobal("innerHeight",844);
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
  const top=this.id==="composer"?600:0,width=this.getAttribute("role")==="region"?272:390,height=this.getAttribute("role")==="region"?257:this.id==="composer"?188:844;
  return {left:0,top,width,height,right:width,bottom:top+height,x:0,y:top,toJSON(){}};
 });
 render(<><div data-call-avoid aria-hidden="true" style={{position:"fixed",inset:0,opacity:0,pointerEvents:"none"}}/><form id="composer" data-target-kind="ticket"/></>);
 showVideo();expect(screen.getByRole("region",{name:"Floating video call"}).style.top).toBe("331px");
});
it("observes composer resizing even when the page shell stays the same size",()=>{
 const observed:Element[]=[];
 vi.stubGlobal("ResizeObserver",class{observe(element:Element){observed.push(element);}disconnect(){}});
 render(<form data-target-kind="ticket" aria-label="Reply composer"/>);showVideo();
 expect(observed).toContain(screen.getByRole("form",{name:"Reply composer"}));
});

it("compacts the video instead of covering the composer when the visual viewport is short",()=>{
 expect(placeCallWindow("bottom-right",272,257,{left:0,top:0,right:390,bottom:400},[
  {left:0,top:0,right:390,bottom:64},{left:0,top:250,right:390,bottom:400}
 ])).toEqual({x:106,y:76,height:162});
});

function obstacleCollectionFixture(){
 const frames:FrameRequestCallback[]=[];
 vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
 vi.stubGlobal("cancelAnimationFrame",vi.fn());
 const observed:Element[]=[];
 vi.stubGlobal("ResizeObserver",class{observe(element:Element){observed.push(element);}disconnect(){}});
 render(<div><form data-target-kind="ticket"><div contentEditable suppressContentEditableWarning aria-label="Draft">Initial draft</div></form><div data-testid="page-controls"/></div>);
 const editor=screen.getByLabelText("Draft"),page=screen.getByTestId("page-controls");
 const collect=vi.spyOn(document.body,"querySelectorAll");
 showVideo();
 const flush=async(change:()=>void)=>{await act(async()=>{change();await Promise.resolve();for(const callback of frames.splice(0))callback(0);});};
 const queries=()=>collect.mock.calls.map(([selector])=>selector).filter(selector=>selector==="*"||selector.includes('form[data-target-kind]'));
 return {queries,flush,observed,editor,page};
}
it("does not recollect obstacles for composer text or attribute edits",async()=>{
 const {queries,flush,editor}=obstacleCollectionFixture();const initial=queries().length;
 await flush(()=>{editor.firstChild!.textContent="Continuing the existing draft";editor.setAttribute("data-typing","true");editor.style.minHeight="80px";});
 expect(queries()).toHaveLength(initial);
 await flush(()=>{editor.textContent="A replacement text node";});
 expect(queries()).toHaveLength(initial);
});
it("recollects for added or removed controls and viewport resize using explicit selectors",async()=>{
 const {queries,flush,observed,page}=obstacleCollectionFixture();const initial=queries().length;
 expect(queries().every(selector=>!selector.includes("*"))).toBe(true);
 const bar=document.createElement("footer");bar.setAttribute("data-call-avoid","");
 await flush(()=>{page.append(bar);});expect(queries()).toHaveLength(initial+1);expect(observed).toContain(bar);
 await flush(()=>{bar.remove();});expect(queries()).toHaveLength(initial+2);
 await flush(()=>{window.dispatchEvent(new Event("resize"));});expect(queries()).toHaveLength(initial+3);
});
it("reuses collected obstacles when the user changes corners",async()=>{
 const {queries,flush}=obstacleCollectionFixture();const initial=queries().length;
 await flush(()=>{fireEvent.keyDown(screen.getByRole("button",{name:/Move call window/}),{key:"ArrowLeft"});});
 expect(queries()).toHaveLength(initial);
 expect(screen.getByRole("region",{name:"Floating video call"})).toHaveAttribute("data-corner","bottom-left");
});

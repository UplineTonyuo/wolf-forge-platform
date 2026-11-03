/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
vi.mock("../components/account/ui/portal-dialog",()=>({PortalDialog:({children,open,title}:{children:React.ReactNode;open:boolean;title:string})=>open?<div role="dialog" aria-label={title}>{children}</div>:null}));
import { CallScreen } from "../components/calls/call-screen";
import { emptyMedia } from "../components/calls/call-media";
import type { CallController,CallState } from "../components/calls/call-controller";
import type { CallMedia } from "../components/calls/call-media";
const id="71000000-0000-4000-8000-000000000001",other="71000000-0000-4000-8000-000000000002";
const call={id,ticketId:id,callerId:other,calleeId:id,mode:"audio",state:"ringing",expiresAt:"2026-11-03T12:15:00Z"} as CallState["call"];
const state={call,peer:{name:"Synthetic client",avatarUrl:null},busy:false,error:"",minimized:false,canJoin:false,joinAttempt:0};
const command=vi.fn();const controller={profileId:id,command,close:vi.fn(),minimize:vi.fn(),end:vi.fn(),allowJoin:vi.fn()} as unknown as CallController;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
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

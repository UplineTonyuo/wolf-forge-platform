/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const f=vi.hoisted(()=>({current:vi.fn()}));
vi.mock("../components/calls/call-provider",()=>({useInboxCalls:f.current}));
vi.mock("../components/calls/call-notifications",()=>({CallNotifications:()=>null}));
import { TicketCallControls } from "../components/tickets/ticket-call-controls";
const id="71000000-0000-4000-8000-000000000001";
let snapshot:{call:{state:string}|null;busy:boolean;error:string}={call:null,busy:false,error:""};
const controller={refresh:vi.fn(),prepare:vi.fn(),snapshot:()=>snapshot,subscribe:()=>()=>{},request:vi.fn(),minimize:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();snapshot={call:null,busy:false,error:""};controller.refresh.mockResolvedValue({enabled:true});controller.prepare.mockResolvedValue({enabled:true,peer:{name:"Synthetic participant",avatarUrl:null}});f.current.mockReturnValue(controller);});
afterEach(()=>cleanup());
it("hides calling when no shared shell or server grant exists",async()=>{
 f.current.mockReturnValue(null);const {container,rerender}=render(<TicketCallControls ticketId={id}/>);expect(container).toBeEmptyDOMElement();
 f.current.mockReturnValue(controller);controller.refresh.mockResolvedValue({enabled:false});rerender(<TicketCallControls ticketId={id}/>);await waitFor(()=>expect(controller.refresh).toHaveBeenCalled());expect(container).toBeEmptyDOMElement();
});
it("preserves reply restrictions and requires an explicit call click",async()=>{
 const {rerender}=render(<TicketCallControls ticketId={id} disabled/>);expect(await screen.findByRole("button",{name:"Voice call"})).toBeDisabled();expect(controller.request).not.toHaveBeenCalled();
 rerender(<TicketCallControls ticketId={id}/>);fireEvent.click(screen.getByRole("button",{name:"Video call"}));expect(controller.request).not.toHaveBeenCalled();expect(await screen.findByRole("button",{name:"Preview camera and microphone"})).toBeInTheDocument();expect(screen.getByRole("button",{name:"Start call"})).toBeDisabled();
});
it("does not create a recurring eligibility polling interval",async()=>{
 vi.useFakeTimers();try{render(<TicketCallControls ticketId={id}/>);await vi.advanceTimersByTimeAsync(60000);expect(controller.refresh).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
});
it("does not issue repeated call reads from live transcript hints while calling is off",async()=>{
 controller.refresh.mockResolvedValue({enabled:false});vi.useFakeTimers();try{
 render(<TicketCallControls ticketId={id}/>);await vi.advanceTimersByTimeAsync(10000);
 window.dispatchEvent(new CustomEvent("wolf-forge-ticket-live",{detail:id}));await vi.advanceTimersByTimeAsync(10000);expect(controller.refresh).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it("recovers controls after a transient offline read",async()=>{
 controller.refresh.mockResolvedValueOnce(null).mockResolvedValue({enabled:true});render(<TicketCallControls ticketId={id}/>);
 await waitFor(()=>expect(controller.refresh).toHaveBeenCalledOnce());window.dispatchEvent(new Event("online"));expect(await screen.findByRole("button",{name:"Voice call"})).toBeInTheDocument();
});
it("uses icon buttons with accessible labels and no toolbar notification enrollment",async()=>{
 render(<TicketCallControls ticketId={id}/>);
 const voice=await screen.findByRole("button",{name:"Voice call"});
 expect(voice).toHaveAttribute("title","Voice call");
 expect(voice).toHaveTextContent("");
 expect(voice.querySelector("svg")).not.toBeNull();
 expect(screen.queryByRole("button",{name:/Enable call alerts/})).not.toBeInTheDocument();
});
it("incoming call unmounts preparation and releases its preview tracks",async()=>{
 const original=Object.getOwnPropertyDescriptor(navigator,"mediaDevices");const stop=vi.fn();
 const track={readyState:"live",stop};const stream={getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]};
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue(stream),enumerateDevices:async()=>[]}});
 try{const {rerender}=render(<TicketCallControls ticketId={id}/>);fireEvent.click(await screen.findByRole("button",{name:"Voice call"}));fireEvent.click(await screen.findByRole("button",{name:"Check microphone"}));await screen.findByText(/Microphone ready/);
  snapshot={...snapshot,call:{state:"ringing"}};rerender(<TicketCallControls ticketId={id}/>);expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(stop).toHaveBeenCalledOnce();
 }finally{if(original)Object.defineProperty(navigator,"mediaDevices",original);else Reflect.deleteProperty(navigator,"mediaDevices");}
});

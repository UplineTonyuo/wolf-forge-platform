/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CallScreen } from "../components/calls/call-screen";
import { emptyMedia, type CallMedia } from "../components/calls/call-media";
import type { CallController, CallState } from "../components/calls/call-controller";
import { PortalDialog } from "../components/account/ui/portal-dialog";
const id="71000000-0000-4000-8000-000000000001";
afterEach(cleanup);
it("places the incoming card on the call layer, traps focus and restores it without starting media",()=>{
 const command=vi.fn();const end=vi.fn();const controller={profileId:id,command,end,close:vi.fn(),minimize:vi.fn()} as unknown as CallController;
 const state={call:{id,calleeId:id,callerId:id+"other",mode:"video",state:"ringing",expiresAt:new Date(Date.now()+40000).toISOString()},peer:{name:"Incoming Person",role:"Client",avatarUrl:null},busy:false,error:"",minimized:false,canJoin:false,joinAttempt:0} as CallState;
 const trigger=document.createElement("button");document.body.append(trigger);trigger.focus();
 const view=render(<CallScreen state={state} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={0}/>);
 const dialog=screen.getByRole("dialog");
 expect(dialog.closest(".portal-overlay")).toHaveAttribute("data-layer","call");
 expect(screen.getByText("Client")).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Minimize call"})).not.toBeInTheDocument();
 expect(command).not.toHaveBeenCalled();
 screen.getByRole("button",{name:"Decline"}).focus();fireEvent.keyDown(document,{key:"Tab"});
 expect(screen.getByRole("button",{name:"Answer"})).toHaveFocus();
 fireEvent.keyDown(document,{key:"Escape"});expect(command).toHaveBeenCalledWith("decline");
 view.unmount();expect(trigger).toHaveFocus();trigger.remove();
});
it("promotes the existing call variant to the native top layer and closes it on unmount",()=>{
 const showDescriptor=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");
 const closeDescriptor=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
 const show=vi.fn(function(this:HTMLDialogElement){this.setAttribute("open","");});
 const close=vi.fn(function(this:HTMLDialogElement){this.removeAttribute("open");});
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:show});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:close});
 try{
  const view=render(<PortalDialog open layer="call" title="Incoming call" onClose={()=>{}}><button>Answer</button></PortalDialog>);
  expect(screen.getAllByRole("dialog",{name:"Incoming call"})).toHaveLength(1);expect(show).toHaveBeenCalledOnce();
  view.unmount();expect(close).toHaveBeenCalledOnce();
 }finally{
  if(showDescriptor)Object.defineProperty(HTMLDialogElement.prototype,"showModal",showDescriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");
  if(closeDescriptor)Object.defineProperty(HTMLDialogElement.prototype,"close",closeDescriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");
 }
});

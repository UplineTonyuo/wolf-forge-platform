/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CallController } from "../components/calls/call-controller";
import { CallPrepare } from "../components/calls/call-prepare";
vi.mock("../components/calls/call-screen", () => ({ Portrait: ({ name }: { name: string }) => <span>{name}</span>, VideoTrack: () => null }));
const client = "71000000-0000-4000-8000-000000000001";
const ids = [2, 3, 4].map(n => `71000000-0000-4000-8000-00000000000${n}`);
const people = ids.map((profileId, i) => ({ profileId, name: `Teammate ${i + 1}`, role: ["Owner", "Administrator", "Manager"][i], avatarUrl: null }));
const stop = vi.fn();
beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }], getAudioTracks: () => [{ readyState: "live" }], getVideoTracks: () => [] })),
    enumerateDevices: async () => [],
  } });
});
afterEach(cleanup);
function mount(candidates = people) {
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST"
    ? Response.json({ ok: false }, { status: 403 })
    : Response.json({ ok: true, data: { enabled: true, profileId: client, accountClass: "client", call: null, peer: null, ticketId: client, candidates } }));
  const controller = new CallController(client, send as typeof fetch);
  render(<CallPrepare ticketId={client} mode="audio" controller={controller} onClose={() => {}} />);
  return send;
}
it("requires one explicit choice when three saved teammates are available", async () => {
  const send = mount();
  const options = await screen.findAllByRole("radio");
  expect(options).toHaveLength(3);
  expect(screen.getByText("Administrator")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check microphone" })).toBeDisabled();
  fireEvent.click(options[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start call" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start call" }));
  await waitFor(() => expect(send.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const body = JSON.parse(send.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string);
  expect(body.recipient_id).toBe(ids[1]);
  expect(Array.isArray(body.recipient_id)).toBe(false);
  expect(send.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
it("preselects the sole saved eligible teammate", async () => {
  mount(people.slice(0, 1));
  expect(await screen.findByRole("radio")).toBeChecked();
  expect(screen.getByRole("button", { name: "Check microphone" })).toBeEnabled();
});
it("explains unavailability without acquiring devices when nobody saved the Ticket", async () => {
  mount([]);
  expect(await screen.findByText(/No eligible team member has this Ticket in their Inbox/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check microphone" })).toBeDisabled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
it("requires an eligible client choice for a native order and sends only order_id",async()=>{
 const send=vi.fn(async(_url:unknown,init?:RequestInit)=>init?.method==="POST"?Response.json({ok:false},{status:403}):Response.json({ok:true,data:{enabled:true,profileId:client,accountClass:"internal",call:null,peer:null,ticketId:null,orderId:client,candidates:people.slice(0,2)}}));
 render(<CallPrepare ticketId={client} order mode="audio" controller={new CallController(client,send as typeof fetch)} onClose={()=>{}}/>);
 const choices=await screen.findAllByRole("radio");expect(choices).toHaveLength(2);
 expect(screen.getByRole("button",{name:"Check microphone"})).toBeDisabled();fireEvent.click(choices[0]!);
 fireEvent.click(screen.getByRole("button",{name:"Check microphone"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Start call"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"Start call"}));
 await waitFor(()=>expect(send.mock.calls.some(([,init])=>init?.method==="POST")).toBe(true));
 const body=JSON.parse(send.mock.calls.find(([,init])=>init?.method==="POST")![1]!.body as string);
 expect(body).toMatchObject({order_id:client,recipient_id:ids[0]});expect(body).not.toHaveProperty("ticket_id");
});
it("uses the legitimate linked Ticket peer returned for an internal order",async()=>{
 const send=vi.fn(async()=>Response.json({ok:true,data:{enabled:true,profileId:client,accountClass:"internal",call:null,peer:{name:"Linked client",avatarUrl:null},ticketId:ids[0],orderId:client}}));
 render(<CallPrepare ticketId={client} order mode="audio" controller={new CallController(client,send as typeof fetch)} onClose={()=>{}}/>);
 expect(await screen.findByRole("heading",{name:"Linked client"})).toBeInTheDocument();expect(screen.queryByRole("radio")).toBeNull();
 expect(screen.getByRole("button",{name:"Check microphone"})).toBeEnabled();
});

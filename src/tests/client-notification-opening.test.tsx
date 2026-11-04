/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({list:vi.fn(),read:vi.fn(),single:vi.fn()}));
vi.mock("../app/actions/notifications",()=>({getClientNotificationsAction:f.list,markClientNotificationReadAction:f.single,markOpenedClientNotificationsReadAction:f.read}));
vi.mock("../lib/notifications/browser-notification-feedback",()=>({playNotificationChime:vi.fn(),unlockNotificationAudio:vi.fn()}));
import {ClientNotificationBell} from "../components/account/client-notification-bell";
import {HeaderPanelsProvider} from "../components/account/command/header-panels";
const item={id:"71000000-0000-4000-8000-000000000001",companyId:null,title:"Synthetic notification",body:"Activity",reason:null,createdAt:new Date().toISOString(),href:"/account",kind:"credit",category:"payment",audience:"client",readAt:null};
const acknowledged={ok:true,notifications:[{...item,readAt:new Date().toISOString()}],unreadCount:0};
beforeEach(()=>{vi.resetAllMocks();Object.defineProperty(document,"hidden",{configurable:true,value:false});Object.defineProperty(navigator,"onLine",{configurable:true,value:true});window.matchMedia=vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()});f.list.mockResolvedValue({ok:true,notifications:[item],unreadCount:151});f.read.mockResolvedValue(acknowledged);});
afterEach(cleanup);
it.each([false,true])("marks the complete opening snapshot without hover mutation; managed=%s",async(managed)=>{
 render(managed?<HeaderPanelsProvider><ClientNotificationBell inCommandBar/></HeaderPanelsProvider>:<ClientNotificationBell/>);
 await screen.findByLabelText("151 unread notifications");expect(f.read).not.toHaveBeenCalled();
 const bell=screen.getByRole("button",{name:"Notifications"});fireEvent.pointerEnter(bell,{pointerType:"mouse"});expect(f.read).not.toHaveBeenCalled();
 fireEvent.click(bell);await waitFor(()=>expect(f.read).toHaveBeenCalledOnce());expect(f.read.mock.calls[0]?.[0]).toMatchObject({requestId:expect.any(String),requestedAt:expect.any(String)});
 await waitFor(()=>expect(screen.queryByLabelText(/unread notifications/)).toBeNull());
});
it("keeps the badge and retries exactly the same request after unconfirmed acknowledgment",async()=>{
 f.read.mockResolvedValueOnce({ok:false,notifications:[],error:"Unavailable"});render(<ClientNotificationBell/>);await screen.findByLabelText("151 unread notifications");fireEvent.click(screen.getByRole("button",{name:"Notifications"}));
 fireEvent.click(await screen.findByRole("button",{name:"Retry marking read"}));await waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));expect(f.read.mock.calls[0]?.[0]).toEqual(f.read.mock.calls[1]?.[0]);await waitFor(()=>expect(screen.queryByLabelText(/unread notifications/)).toBeNull());
});
it("opens before initial loading completes and discards a stale list after acknowledgment",async()=>{
 let finish!:(value:unknown)=>void;f.list.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(acknowledged);render(<ClientNotificationBell/>);await waitFor(()=>expect(f.list).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole("button",{name:"Notifications"}));await waitFor(()=>expect(f.read).toHaveBeenCalledOnce());await act(async()=>finish({ok:true,notifications:[item],unreadCount:151}));expect(screen.queryByLabelText(/unread notifications/)).toBeNull();
});
it("preserves later arrivals in the authoritative acknowledgment",async()=>{
 f.read.mockResolvedValue({...acknowledged,notifications:[item],unreadCount:1});render(<ClientNotificationBell/>);await screen.findByLabelText("151 unread notifications");fireEvent.click(screen.getByRole("button",{name:"Notifications"}));await screen.findByLabelText("1 unread notifications");expect(f.read).toHaveBeenCalledOnce();
});
it("queues another deliberate opening while the earlier snapshot is unconfirmed",async()=>{
 let finish!:(value:unknown)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render(<ClientNotificationBell/>);await screen.findByLabelText("151 unread notifications");const bell=screen.getByRole("button",{name:"Notifications"});fireEvent.click(bell);fireEvent.click(bell);fireEvent.click(bell);await act(async()=>finish({...acknowledged,notifications:[item],unreadCount:1}));await waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));expect(f.read.mock.calls[0]?.[0].requestId).not.toBe(f.read.mock.calls[1]?.[0].requestId);await waitFor(()=>expect(screen.queryByLabelText(/unread notifications/)).toBeNull());
});
it("recovers an expired or clock-skewed opening only through a new explicit action",async()=>{
 f.read.mockResolvedValueOnce({ok:false,notifications:[],error:"Opening expired",code:"OPENING_EXPIRED",serverTime:"2026-11-04T00:00:00Z"});
 render(<ClientNotificationBell/>);await screen.findByLabelText("151 unread notifications");const bell=screen.getByRole("button",{name:"Notifications"});fireEvent.click(bell);
 const retry=await screen.findByRole("button",{name:"Mark current notifications read"});expect(f.read).toHaveBeenCalledOnce();fireEvent.click(retry);
 await waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));expect(f.read.mock.calls[0]?.[0].requestId).not.toBe(f.read.mock.calls[1]?.[0].requestId);
 expect(Date.parse(f.read.mock.calls[1]?.[0].requestedAt)).toBeLessThan(Date.parse("2026-11-04T00:01:00Z"));
 await waitFor(()=>expect(screen.queryByLabelText(/unread notifications/)).toBeNull());
});
it("refreshes the complete unread count after an individual row is opened from hover",async()=>{
 f.single.mockResolvedValue(undefined);render(<HeaderPanelsProvider><ClientNotificationBell inCommandBar/></HeaderPanelsProvider>);await screen.findByLabelText("151 unread notifications");
 f.list.mockResolvedValue({ok:true,notifications:[{...item,readAt:new Date().toISOString()}],unreadCount:150});
 fireEvent.pointerEnter(screen.getByRole("button",{name:"Notifications"}),{pointerType:"mouse"});fireEvent.click(await screen.findByText(item.title));
 await screen.findByLabelText("150 unread notifications");expect(f.read).not.toHaveBeenCalled();expect(f.single).toHaveBeenCalledWith(item.id);
});

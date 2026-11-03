/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientPushNotifications } from "../components/account/profile/client-push-notifications";
import { browserPushEndpointStateAction,clientPushStatusAction,setClientPushAction } from "../app/actions/push";

vi.mock("../app/actions/push",()=>({browserPushEndpointStateAction:vi.fn(),clientPushStatusAction:vi.fn(),setClientPushAction:vi.fn()}));
const endpoint="https://fcm.googleapis.com/wp/synthetic";
const unsubscribe=vi.fn().mockResolvedValue(true);
const subscribe=vi.fn().mockResolvedValue({endpoint,unsubscribe});
const getSubscription=vi.fn().mockResolvedValue(null);
const registration={pushManager:{getSubscription,subscribe},getNotifications:vi.fn().mockResolvedValue([])};
const register=vi.fn().mockResolvedValue(registration);
const requestPermission=vi.fn().mockResolvedValue("granted");
const config={origin:"https://studio.invalid",publicKey:btoa("a".repeat(65)).replace(/=/g,"")};
beforeEach(()=>{
  vi.clearAllMocks();getSubscription.mockResolvedValue(null);subscribe.mockResolvedValue({endpoint,unsubscribe});
  vi.mocked(clientPushStatusAction).mockResolvedValue(false);vi.mocked(setClientPushAction).mockResolvedValue({ok:true});
  vi.mocked(browserPushEndpointStateAction).mockResolvedValue("owned");
  Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{register,getRegistration:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
  Object.defineProperty(window,"PushManager",{configurable:true,value:function(){}});
  Object.defineProperty(window,"Notification",{configurable:true,value:{permission:"default",requestPermission}});
  requestPermission.mockResolvedValue("granted");
});
it("rotates only an authoritatively foreign endpoint after the new account's setup gesture",async()=>{
 getSubscription.mockResolvedValue({endpoint,unsubscribe});vi.mocked(browserPushEndpointStateAction).mockResolvedValue("foreign");
 render(<ClientPushNotifications config={config}/>);fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
 await screen.findByText("Notifications are enabled on this device.");expect(unsubscribe).toHaveBeenCalledOnce();expect(subscribe).toHaveBeenCalledOnce();
});
it("does not rotate an endpoint when ownership cannot be confirmed",async()=>{
 getSubscription.mockResolvedValue({endpoint,unsubscribe});vi.mocked(browserPushEndpointStateAction).mockResolvedValue(null);
 render(<ClientPushNotifications config={config}/>);fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
 await screen.findByText("Notifications could not be enabled. Please try again.");expect(unsubscribe).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
});
afterEach(cleanup);
it("does not prompt or subscribe on page load",async()=>{
  render(<ClientPushNotifications config={config}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Enable on this device"})).toBeEnabled());
  expect(requestPermission).not.toHaveBeenCalled();expect(register).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
});
it("saves consent only after an explicit grant and subscription",async()=>{
  render(<ClientPushNotifications config={config}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
  await screen.findByText("Notifications are enabled on this device.");
  expect(requestPermission).toHaveBeenCalledOnce();expect(setClientPushAction).toHaveBeenCalledWith(endpoint,true);
  expect(register).not.toHaveBeenCalled();expect(subscribe).toHaveBeenCalledOnce();
});
it("does not register after permission denial",async()=>{
  requestPermission.mockResolvedValue("denied");render(<ClientPushNotifications config={config}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
  await screen.findByText("Notifications were not enabled. You can keep using the notification bell.");
  expect(register).not.toHaveBeenCalled();expect(setClientPushAction).not.toHaveBeenCalled();
});
it("preserves the shared endpoint when server registration cannot be confirmed",async()=>{
  vi.mocked(setClientPushAction).mockResolvedValue({ok:false});render(<ClientPushNotifications config={config}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
  await screen.findByText("Notifications could not be enabled. Please try again.");expect(unsubscribe).not.toHaveBeenCalled();
});
it("disables message delivery without unsubscribing the shared call endpoint",async()=>{
  getSubscription.mockResolvedValue({endpoint,unsubscribe});vi.mocked(clientPushStatusAction).mockResolvedValue(true);
  render(<ClientPushNotifications config={config}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Turn off on this device"}));
  await screen.findByText("Notifications are turned off on this device.");
  expect(setClientPushAction).toHaveBeenCalledWith(endpoint,false);expect(unsubscribe).not.toHaveBeenCalled();
});
it("reuses a calls-only endpoint when ordinary message notifications are enabled",async()=>{
 getSubscription.mockResolvedValue({endpoint,unsubscribe});vi.mocked(clientPushStatusAction).mockResolvedValue(false);
 render(<ClientPushNotifications config={config}/>);fireEvent.click(await screen.findByRole("button",{name:"Enable on this device"}));
 await screen.findByText("Notifications are enabled on this device.");expect(unsubscribe).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
});

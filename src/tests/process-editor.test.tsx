/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProcessEditor } from "../components/settings/process-editor";
import { saveProcess } from "../app/actions/process";
vi.mock("../app/actions/process",()=>({saveProcess:vi.fn(async()=>null)}));
afterEach(cleanup);

it("adds Needs Review, reorders it, and saves its stable key as the revision destination",async()=>{
  const waiting={key:"waiting_reply",name:"Waiting Reply",color:"#334455",description:"Awaiting client"};
  render(<ProcessEditor section="orders" version={3} settings={{entries:[waiting],destination:waiting.key,reopen:false,lock:false,ratings:false}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Add stage"}));
  const added=screen.getByRole("group",{name:"New stage"});
  fireEvent.change(within(added).getByLabelText("Name"),{target:{value:"Needs Review"}});
  fireEvent.change(within(added).getByLabelText("Description"),{target:{value:"Review revised work"}});
  fireEvent.click(screen.getByRole("button",{name:"Move Needs Review up"}));
  fireEvent.click(screen.getByLabelText("Allow clients to request revisions on completed orders"));
  fireEvent.click(screen.getByRole("button",{name:"Reopen revisions in: Waiting Reply"}));
  fireEvent.click(screen.getByRole("option",{name:"Needs Review"}));
  fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
  expect(await screen.findByText("Changes saved.")).toBeVisible();
  const [section,version,config]=vi.mocked(saveProcess).mock.calls[0]!;
  expect([section,version]).toEqual(["orders",3]);
  expect(config.entries.map(e=>e.name)).toEqual(["Needs Review","Waiting Reply"]);
  expect(config.destination).toBe(config.entries[0]?.key);
  expect(config.reopen).toBe(true);
});


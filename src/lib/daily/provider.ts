import "server-only";
import { z } from "zod";
import type { CallProvider } from "../../services/ticket-call-provider";
import { dailyRequest } from "./calls";

const roomName = z.string().regex(/^wf-call-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export function createDailyCallProvider(key: string, timeoutMs=8000): CallProvider & { readPresence(name:string):Promise<unknown> } {
  const read=(endpoint:string,method="GET",body?:unknown)=>dailyRequest(key,endpoint,method,body,timeoutMs);
  const path = (name: string) => `rooms/${roomName.parse(name)}`;
  return {
    createRoom: (name, properties) => read("rooms","POST",{ name:roomName.parse(name), privacy:"private", properties }),
    readRoom: name => read(path(name)),
    createToken: properties => read("meeting-tokens","POST",{properties}),
    deleteRoom: name => read(path(name),"DELETE"),
    readPresence: name => read(`${path(name)}/presence?limit=2`),
    async ejectRoom(name) {
      const resource=path(name);
      const presence=z.object({total_count:z.number().int().min(0).max(2),data:z.array(z.object({id:z.string().min(1).max(128),room:z.literal(name)})).max(2)})
        .parse(await read(`${resource}/presence?limit=2`));
      if(presence.total_count!==presence.data.length)throw new Error("Incomplete room presence");
      if(!presence.data.length)return;
      return read(`${resource}/eject`,"POST",{ids:presence.data.map(p=>p.id)});
    },
  };
}

import { describe, expect, it } from "vitest";
import * as window from "../domain/orders/conversation-page";
import type { TicketDetailMessage } from "../domain/tickets/schema";
import type { CallHistoryEntry } from "../domain/tickets/calls";

function message(n: number): TicketDetailMessage {
  return { id: `m${String(n).padStart(4,"0")}`, created_at: `2026-11-10T00:00:00.${String(n).padStart(6,"0")}Z`,
    body: `Message ${n}`, attachments: [], reactions: [], visibility: "client", message_kind: "reply" } as unknown as TicketDetailMessage;
}
describe("bounded Order timeline", () => {
  it("retains microsecond ordering when timestamps fall within the same millisecond", () => {
    expect(window.compareConversationTime(message(2).created_at,message(1).created_at)).toBeGreaterThan(0);
  });
  it("bounds persisted messages and calls together while retaining pending sends separately", () => {
    const messages = Array.from({length:120},(_,n)=>message(n));
    const calls = Array.from({length:50},(_,n)=>({ id:`call${n}`,requestedAt:message(n*2).created_at })) as CallHistoryEntry[];
    const result = window.retainOrderTimeline([...messages,{...message(121),pending:true}],calls,"after",null);
    expect(result.messages.filter(m=>!m.pending).length+result.calls.length).toBe(100);
    expect(result.messages.some(m=>m.pending)).toBe(true);
    expect(result.messages.at(-2)?.id).toBe("m0119");
  });
  it("never silently evicts an active reading anchor when prepending a distant call page", () => {
    const messages = Array.from({length:100},(_,n)=>message(n+100));
    const calls = Array.from({length:50},(_,n)=>({id:`call${n}`,requestedAt:message(n).created_at})) as CallHistoryEntry[];
    const result = window.retainOrderTimeline(messages,calls,"before","m0150");
    expect(result.messages.some(m=>m.id==="m0150")).toBe(true);
    expect(result.messages.length+result.calls.length).toBe(100);
  });
  it("reconstructs directional reload cursors from exact persisted timestamps without a Date conversion", () => {
    expect(JSON.parse(window.orderMessageCursor("order","project:order","before",message(123))!)).toEqual({
      order:"order",source:"project:order",direction:"before",at:"2026-11-10T00:00:00.000123Z",id:"m0123",
    });
  });
});

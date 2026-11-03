import { afterEach, expect, it, vi } from "vitest";
import { createDailyCallProvider } from "../lib/daily/provider";
const room = "wf-call-71000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
it("refuses non-product room names without a request", async () => {
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  expect(() => createDailyCallProvider("test-key").readRoom("../other")).toThrow();
  expect(send).not.toHaveBeenCalled();
});
it("ejects only verified room-presence ids, not an unsupported eject-all payload", async () => {
  const send = vi.fn().mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: "p1", room }] }))
    .mockResolvedValueOnce(Response.json({ ejectedIds: ["p1"] })); vi.stubGlobal("fetch",send);
  await createDailyCallProvider("test-key").ejectRoom(room);
  expect(send.mock.calls[1]![0]).toBe(`https://api.daily.co/v1/rooms/${room}/eject`);
  expect(JSON.parse(send.mock.calls[1]![1].body)).toEqual({ ids: ["p1"] });
});
it("refuses incomplete or cross-room presence before ejecting", async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ total_count: 2, data: [{ id: "p1", room: "foreign" }] })); vi.stubGlobal("fetch",send);
  await expect(createDailyCallProvider("test-key").ejectRoom(room)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});

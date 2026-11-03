import { describe, expect, it, vi } from "vitest";
import { callRoomProperties, dailyRequest, readDailyCallConfig, verifiedCallRoom } from "../lib/daily/calls";
const config = () => ({ ...callRoomProperties(1234), enable_recording: "" });
const room = () => ({ name: "test", url: "https://wolfforge.daily.co/test", privacy: "private", config: config() });
describe("private Daily calls", () => {
  it("is off by default and refuses an unknown domain or key shape", () => {
    expect(readDailyCallConfig({ NODE_ENV: "test" })).toBeNull();
    expect(readDailyCallConfig({ NODE_ENV: "test", DAILY_CALLS_ENABLED: "1", DAILY_DOMAIN: "other.daily.co", DAILY_API_KEY: "test" })).toBeNull();
    expect(readDailyCallConfig({ NODE_ENV: "test", DAILY_CALLS_ENABLED: "1", DAILY_DOMAIN: "wolfforge.daily.co", DAILY_API_KEY: "test key" })).toBeNull();
  });
  it("accepts only the bounded private room", () => {
    expect(verifiedCallRoom(room(), "test", 1234)).toBe(true);
    for (const value of [{ ...room(), privacy: "public" }, { ...room(), url: "https://other.daily.co/test" },
      { ...room(), config: { ...config(), max_participants: 3 } },
      { ...room(), config: { ...config(), eject_at_room_exp: false } },
      { ...room(), config: { ...config(), exp: 1235 } },
      { ...room(), config: { ...config(), enable_recording: "cloud" } },
      { ...room(), config: { ...config(), auto_start_transcription: true } },
      { ...room(), config: { ...config(), permissions: { canAdmin: true } } }]) {
      expect(verifiedCallRoom(value, "test", 1234)).toBe(false);
    }
  });
  it("bounds provider responses and forbids redirects without leaking keys", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("x".repeat(33000)));
    vi.stubGlobal("fetch", fetcher);
    await expect(dailyRequest("test-key", "rooms/test")).rejects.toThrow("limit");
    expect(fetcher).toHaveBeenCalledWith("https://api.daily.co/v1/rooms/test", expect.objectContaining({ redirect: "error", cache: "no-store" }));
    vi.unstubAllGlobals();
  });
});

import "server-only";

export const DAILY_CALL_ORIGIN = "https://wolfforge.daily.co";
export type CallMode = "audio" | "video";

export function readDailyCallConfig(env: NodeJS.ProcessEnv = process.env) {
  const key = env.DAILY_API_KEY;
  if (env.DAILY_CALLS_ENABLED !== "1" || env.DAILY_DOMAIN !== "wolfforge.daily.co" ||
    !key || key.length > 1024 || /\s/.test(key)) return null;
  return { key, origin: DAILY_CALL_ORIGIN };
}

export function callRoomProperties(expiresAt: number) {
  return {
    exp: expiresAt, eject_at_room_exp: true, max_participants: 2,
    enforce_unique_user_ids: true, enable_prejoin_ui: true,
    enable_screenshare: false, enable_chat: false, enable_recording: false,
    enable_live_captions_ui: false, enable_transcription_storage: false,
    enable_dialout: false, permissions: { canAdmin: false },
  };
}

export function verifiedCallRoom(value: unknown, name: string, expiresAt: number) {
  if (!value || typeof value !== "object") return false;
  const room = value as Record<string, unknown>;
  if (room.name !== name || room.url !== `${DAILY_CALL_ORIGIN}/${name}` || room.privacy !== "private" ||
    !room.config || typeof room.config !== "object") return false;
  const config = room.config as Record<string, unknown>;
  if (config.exp !== expiresAt || config.eject_at_room_exp !== true || config.max_participants !== 2 ||
    config.enforce_unique_user_ids !== true || config.enable_screenshare !== false ||
    (config.enable_recording !== false && config.enable_recording !== "") ||
    !config.permissions || typeof config.permissions !== "object" ||
    (config.permissions as Record<string, unknown>).canAdmin !== false) return false;
  return Object.entries(config).every(([key, setting]) => !/record|transcri|dialout|sip|streaming|rtmp|live_captions/i.test(key) ||
    (key === "enable_recording" && setting === "") || setting === false || setting === null ||
    (Array.isArray(setting) && setting.length === 0));
}

export async function dailyRequest(key: string, endpoint: string, method = "GET", body?: unknown, timeoutMs = 8_000) {
  const response = await fetch(`https://api.daily.co/v1/${endpoint}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok || !response.body) throw new Error("Call provider unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new Error("Call response exceeded its limit");
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) as unknown : {};
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

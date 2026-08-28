import type { TeamLiveSyncRow } from "../../domain/team/schema";
import type { TeamSyncResult, TeamActionResult } from "../../app/actions/team-messages";

export type TeamSyncRequest = {
  includeConversations: boolean;
  includeTasks: boolean;
  includeTeamTasks: boolean;
  includeMembers: boolean;
  materializeDigests: boolean;
};

export type TeamLiveRequest = {
  conversationId: string | null;
  since: string | null;
};

async function post<T>(
  endpoint: string,
  body: unknown,
  fallback: string,
  signal?: AbortSignal,
): Promise<TeamActionResult<T>> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    const result = (await response.json().catch(() => null)) as TeamActionResult<T> | null;
    if (result && typeof result.ok === "boolean") return result;
    return { ok: false, error: fallback };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, error: fallback };
  }
}

/**
 * The fast lane: the open thread with its typing state, plus whichever
 * conversations moved since `since`. One request, one database call.
 */
export function fetchTeamLive(
  input: TeamLiveRequest,
  signal?: AbortSignal,
): Promise<TeamActionResult<TeamLiveSyncRow>> {
  return post("/api/team-live", input, "Team Messages could not be refreshed.", signal);
}

/** The background lane: conversation list, roster, tasks, offline digests. */
export function fetchTeamSync(
  input: TeamSyncRequest,
  signal?: AbortSignal,
): Promise<TeamActionResult<TeamSyncResult>> {
  return post("/api/team-sync", input, "Team Messages could not be refreshed.", signal);
}

export function sendTeamTyping(input: {
  operation: "touch" | "clear";
  conversationId: string;
  connectionId: string;
}): Promise<void> {
  return fetch("/api/team-typing", {
    method: "POST",
    credentials: "same-origin",
    keepalive: input.operation === "clear",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then(() => undefined, () => undefined);
}

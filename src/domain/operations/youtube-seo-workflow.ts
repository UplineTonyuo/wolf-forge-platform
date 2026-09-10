/** Pure read model for the external, read-only YouTube SEO workflow. */

export type YoutubeStageState =
  | "not_started"
  | "in_progress"
  | "completed"
  | "stuck"
  | "paused"
  | "cancelled";

export type YoutubeOperationStatus = YoutubeStageState;

export const youtubeOperationStatuses: readonly YoutubeOperationStatus[] = [
  "not_started",
  "in_progress",
  "stuck",
  "paused",
  "cancelled",
  "completed",
];

export const youtubeOperationStatusLabels: Record<YoutubeOperationStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  stuck: "Stuck",
  paused: "Paused",
  cancelled: "Cancelled",
};

export type YoutubeWorkflowStage = {
  key: "wave" | "youtube";
  label: "Wave Videos" | "YouTube Upload";
  sourceLabel: string;
  state: YoutubeStageState;
  rawStatus: string | null;
  output: string | null;
  outputUrl: string | null;
};

export type YoutubeOperationItem = {
  id: string;
  sourceTab: string;
  sourceSection: string;
  client: string;
  clientUrl: string | null;
  email: string | null;
  loginUrl: string | null;
  orderNumber: string | null;
  seoPackage: string | null;
  primaryKeyword: string | null;
  city: string | null;
  promptSopUrl: string | null;
  assignedVa: string | null;
  notes: string | null;
  waveStage: YoutubeWorkflowStage;
  youtubeStage: YoutubeWorkflowStage;
  normalizedStatus: YoutubeOperationStatus;
};

type IdentityField =
  | "client"
  | "email"
  | "login"
  | "orderNumber"
  | "seoPackage"
  | "primaryKeyword"
  | "city"
  | "promptSop"
  | "assignedVa"
  | "notes";

type StageDefinition = {
  index: number;
  statusIndex: number | null;
  key: YoutubeWorkflowStage["key"];
  label: YoutubeWorkflowStage["label"];
  sourceLabel: string;
};

type HeaderMap = {
  identities: Partial<Record<IdentityField, number[]>>;
  stages: StageDefinition[];
};

const IDENTITY_ALIASES: Record<string, IdentityField> = {
  name: "client",
  client: "client",
  website: "client",
  "website url": "client",
  email: "email",
  login: "login",
  logins: "login",
  "order #": "orderNumber",
  "order number": "orderNumber",
  "seo package": "seoPackage",
  package: "seoPackage",
  "primary keyword": "primaryKeyword",
  city: "city",
  "prompt/ sop": "promptSop",
  "prompt / sop": "promptSop",
  "prompt sop": "promptSop",
  "assigned va": "assignedVa",
  note: "notes",
  notes: "notes",
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function stageFromHeader(value: string): Omit<StageDefinition, "index" | "statusIndex"> | null {
  const normalized = normalize(value).replace(/^\d+\s+/, "");
  if (normalized.includes("wave video")) {
    return { key: "wave", label: "Wave Videos", sourceLabel: value.trim() };
  }
  if (normalized.includes("youtube") || normalized.includes("yt upload")) {
    return { key: "youtube", label: "YouTube Upload", sourceLabel: value.trim() };
  }
  return null;
}

function matchHeaderRow(row: readonly string[]): HeaderMap | null {
  const identities: Partial<Record<IdentityField, number[]>> = {};
  const stages: StageDefinition[] = [];

  row.forEach((value, index) => {
    const identity = IDENTITY_ALIASES[normalize(value)];
    if (identity) (identities[identity] ??= []).push(index);
    const stage = stageFromHeader(value);
    if (!stage) return;
    const nextHeader = normalize(row[index + 1] ?? "");
    stages.push({ ...stage, index, statusIndex: /^status(?: \d+)?$/.test(nextHeader) ? index + 1 : null });
  });

  if (identities.client === undefined) return null;
  if (!stages.some((stage) => stage.key === "wave") || !stages.some((stage) => stage.key === "youtube")) return null;
  return { identities, stages };
}

function firstNonBlank(row: readonly string[], indexes: number[] | undefined): string | null {
  if (!indexes) return null;
  for (const index of indexes) {
    const value = row[index]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Some blocks mislabel a stage's own status column as a second "Assigned VA"
 * header (immediately after that stage's output cell, instead of a real
 * "Status" header), so its real value is a status word like "Completed", not
 * a name. A value that itself parses as a known stage-status word is
 * definitionally not a credible assignee and is skipped in favor of the next
 * candidate column, rather than surfaced as a fabricated-looking VA.
 */
function firstCredibleAssignee(row: readonly string[], indexes: number[] | undefined): string | null {
  if (!indexes) return null;
  for (const index of indexes) {
    const value = row[index]?.trim();
    if (value && normalizeYoutubeStageState(value) === null) return value;
  }
  return null;
}

function cell(row: readonly string[], index: number | undefined | null): string | null {
  if (index === undefined || index === null) return null;
  const value = row[index]?.trim();
  return value ? value : null;
}

function findHttpUrl(value: string | null): string | null {
  return value?.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
}

export function normalizeYoutubeStageState(rawValue: string | null): YoutubeStageState | null {
  const normalized = normalize(rawValue ?? "");
  if (!normalized) return null;
  if (["done", "complete", "completed", "published", "posted"].includes(normalized)) return "completed";
  if (normalized.endsWith("done")) return "completed";
  if (["stuck", "blocked", "needs attention"].includes(normalized)) return "stuck";
  if (["pause", "paused", "on hold"].includes(normalized)) return "paused";
  if (["cancel", "cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["inprogress", "in progress", "working", "ongoing"].includes(normalized)) return "in_progress";
  if (["not started", "pending", "todo", "to do"].includes(normalized)) return "not_started";
  return null;
}

const BLOCKER_SIGNAL = /\b(blocked|stuck|issue|error)\b|can['’]?t\s+post|cannot\s+post|need(?:s)?\s+to\s+verify|doesn['’]?t\s+match|doesnt\s+match/i;

function stageState(rawStatus: string | null, output: string | null): YoutubeStageState {
  return normalizeYoutubeStageState(rawStatus)
    ?? normalizeYoutubeStageState(output)
    ?? (output && BLOCKER_SIGNAL.test(output) ? "stuck" : output ? "in_progress" : "not_started");
}

function overallStatus(stages: readonly YoutubeWorkflowStage[], notes: string | null): YoutubeOperationStatus {
  const states = stages.map((stage) => stage.state);
  if (states.includes("stuck") || BLOCKER_SIGNAL.test(notes ?? "")) return "stuck";
  if (states.includes("paused") || normalizeYoutubeStageState(notes) === "paused") return "paused";
  if (states.includes("cancelled") || normalizeYoutubeStageState(notes) === "cancelled") return "cancelled";
  if (states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state !== "not_started")) return "in_progress";
  return "not_started";
}

type BlockRow = { row: readonly string[]; rowIndex: number; header: HeaderMap; section: string };

function walkBlocks(rows: readonly (readonly string[])[]): BlockRow[] {
  const normalizedRows = rows.map((row) => row.map((value) => value ?? ""));
  const headers = normalizedRows.map(matchHeaderRow);
  const blankRows = normalizedRows.map((row) => row.every((value) => !value.trim()));
  const output: BlockRow[] = [];
  let header: HeaderMap | null = null;
  let section = "YouTube SEO";
  let pendingTitle: string | null = null;
  let blockCount = 0;

  function nextNonBlankIsHeader(rowIndex: number): boolean {
    for (let index = rowIndex + 1; index < normalizedRows.length; index += 1) {
      if (blankRows[index]) continue;
      return headers[index] !== null;
    }
    return false;
  }

  normalizedRows.forEach((row, rowIndex) => {
    if (blankRows[rowIndex]) return;
    const matched = headers[rowIndex];
    if (matched) {
      header = matched;
      blockCount += 1;
      section = pendingTitle ?? (blockCount === 1 ? "YouTube SEO" : `YouTube SEO (block ${blockCount})`);
      pendingTitle = null;
      return;
    }
    const populated = row.filter((value) => value.trim());
    if (populated.length === 1 && nextNonBlankIsHeader(rowIndex)) {
      pendingTitle = populated[0]!.trim();
      return;
    }
    if (header) output.push({ row, rowIndex, header, section });
  });

  return output;
}

export function locateYoutubeSeoLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const header = matchHeaderRow(row);
    if (!header) continue;
    for (const field of ["client", "login", "promptSop"] as const) {
      for (const index of header.identities[field] ?? []) columns.add(index);
    }
    for (const stage of header.stages) columns.add(stage.index);
  }
  return [...columns].sort((left, right) => left - right);
}

export function parseYoutubeSeoWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceTab: string,
): YoutubeOperationItem[] {
  return walkBlocks(rows).flatMap(({ row, rowIndex, header, section }) => {
    const client = firstNonBlank(row, header.identities.client);
    if (!client) return [];

    const parsedStages = header.stages.map((definition) => {
      const rawOutput = cell(row, definition.index);
      const rawStatus = cell(row, definition.statusIndex);
      const outputIsStatus = definition.statusIndex === null && normalizeYoutubeStageState(rawOutput) !== null;
      const output = outputIsStatus ? null : rawOutput;
      return {
        key: definition.key,
        label: definition.label,
        sourceLabel: definition.sourceLabel,
        state: stageState(rawStatus, rawOutput),
        rawStatus: rawStatus ?? (outputIsStatus ? rawOutput : null),
        output,
        outputUrl: findHttpUrl(output),
      } satisfies YoutubeWorkflowStage;
    });
    const waveStage = parsedStages.find((stage) => stage.key === "wave");
    const youtubeStage = parsedStages.find((stage) => stage.key === "youtube");
    if (!waveStage || !youtubeStage) return [];
    const notes = firstNonBlank(row, header.identities.notes);

    // A populated client alone can be a section/template row. A real workflow
    // record must carry at least one stage value or status from the source.
    if (![waveStage.output, waveStage.rawStatus, youtubeStage.output, youtubeStage.rawStatus].some(Boolean)) return [];

    return [{
      id: `${sourceTab}::${section}::${rowIndex}`,
      sourceTab,
      sourceSection: section,
      client,
      clientUrl: findHttpUrl(client),
      email: firstNonBlank(row, header.identities.email),
      loginUrl: findHttpUrl(firstNonBlank(row, header.identities.login)),
      orderNumber: firstNonBlank(row, header.identities.orderNumber),
      seoPackage: firstNonBlank(row, header.identities.seoPackage),
      primaryKeyword: firstNonBlank(row, header.identities.primaryKeyword),
      city: firstNonBlank(row, header.identities.city),
      promptSopUrl: findHttpUrl(firstNonBlank(row, header.identities.promptSop)),
      assignedVa: firstCredibleAssignee(row, header.identities.assignedVa),
      notes,
      waveStage,
      youtubeStage,
      normalizedStatus: overallStatus([waveStage, youtubeStage], notes),
    }];
  });
}

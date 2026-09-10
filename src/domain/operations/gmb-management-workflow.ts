/** Pure read model for the external, read-only GMB Management workflow. */

export type GmbStageState =
  | "not_started"
  | "in_progress"
  | "completed"
  | "stuck"
  | "paused"
  | "cancelled";

export type GmbOperationStatus = GmbStageState;

export const gmbOperationStatuses: readonly GmbOperationStatus[] = [
  "not_started",
  "in_progress",
  "stuck",
  "paused",
  "cancelled",
  "completed",
];

export const gmbOperationStatusLabels: Record<GmbOperationStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  stuck: "Stuck",
  paused: "Paused",
  cancelled: "Cancelled",
};

export type GmbWorkflowStage = {
  key: "content" | "posting";
  label: "GMB Content" | "GMB Posting";
  sourceLabel: string;
  state: GmbStageState;
  rawStatus: string | null;
  output: string | null;
  outputUrl: string | null;
};

export type GmbOperationItem = {
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
  onboardingSheetUrl: string | null;
  notes: string | null;
  contentStage: GmbWorkflowStage;
  postingStage: GmbWorkflowStage;
  normalizedStatus: GmbOperationStatus;
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
  | "onboardingSheet"
  | "notes";

type StageDefinition = {
  index: number;
  statusIndex: number | null;
  key: GmbWorkflowStage["key"];
  label: GmbWorkflowStage["label"];
  sourceLabel: string;
};

type HeaderMap = {
  identities: Partial<Record<IdentityField, number>>;
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
  "ob sheet": "onboardingSheet",
  "onboarding sheet": "onboardingSheet",
  notes: "notes",
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function stageFromHeader(value: string): Omit<StageDefinition, "index" | "statusIndex"> | null {
  const normalized = normalize(value).replace(/^20\s+/, "");
  if (normalized.includes("gmb content")) {
    return { key: "content", label: "GMB Content", sourceLabel: value.trim() };
  }
  if (normalized.includes("gmb posted") || normalized.includes("gmb posting")) {
    return { key: "posting", label: "GMB Posting", sourceLabel: value.trim() };
  }
  return null;
}

function matchHeaderRow(row: readonly string[]): HeaderMap | null {
  const identities: Partial<Record<IdentityField, number>> = {};
  const stages: StageDefinition[] = [];

  row.forEach((value, index) => {
    const identity = IDENTITY_ALIASES[normalize(value)];
    if (identity && identities[identity] === undefined) identities[identity] = index;
    const stage = stageFromHeader(value);
    if (!stage) return;
    const nextHeader = normalize(row[index + 1] ?? "");
    stages.push({ ...stage, index, statusIndex: /^status(?: \d+)?$/.test(nextHeader) ? index + 1 : null });
  });

  if (identities.client === undefined) return null;
  if (!stages.some((stage) => stage.key === "content") || !stages.some((stage) => stage.key === "posting")) return null;
  return { identities, stages };
}

function cell(row: readonly string[], index: number | undefined | null): string | null {
  if (index === undefined || index === null) return null;
  const value = row[index]?.trim();
  return value ? value : null;
}

function findHttpUrl(value: string | null): string | null {
  return value?.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
}

export function normalizeGmbStageState(rawValue: string | null): GmbStageState | null {
  const normalized = normalize(rawValue ?? "");
  if (!normalized) return null;
  if (["done", "complete", "completed", "published", "posted"].includes(normalized)) return "completed";
  if (["stuck", "blocked", "needs attention"].includes(normalized)) return "stuck";
  if (["pause", "paused", "on hold"].includes(normalized)) return "paused";
  if (["cancel", "cancelled", "canceled", "client dont want gmb", "client doesn't want gmb"].includes(normalized)) return "cancelled";
  if (["inprogress", "in progress", "working", "ongoing"].includes(normalized)) return "in_progress";
  if (["not started", "pending", "todo", "to do"].includes(normalized)) return "not_started";
  return null;
}

const BLOCKER_SIGNAL = /\b(blocked|stuck|issue|error)\b|can['’]?t\s+post|cannot\s+post|need(?:s)?\s+to\s+verify|doesn['’]?t\s+match|doesnt\s+match/i;

function stageState(rawStatus: string | null, output: string | null): GmbStageState {
  return normalizeGmbStageState(rawStatus)
    ?? normalizeGmbStageState(output)
    ?? (output && BLOCKER_SIGNAL.test(output) ? "stuck" : output ? "in_progress" : "not_started");
}

function overallStatus(stages: readonly GmbWorkflowStage[], notes: string | null): GmbOperationStatus {
  const states = stages.map((stage) => stage.state);
  if (states.includes("stuck") || BLOCKER_SIGNAL.test(notes ?? "")) return "stuck";
  if (states.includes("paused") || normalizeGmbStageState(notes) === "paused") return "paused";
  if (states.includes("cancelled") || normalizeGmbStageState(notes) === "cancelled") return "cancelled";
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
  let section = "GMB Management";
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
      section = pendingTitle ?? (blockCount === 1 ? "GMB Management" : `GMB Management (block ${blockCount})`);
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

export function locateGmbManagementLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const header = matchHeaderRow(row);
    if (!header) continue;
    for (const field of ["client", "login", "promptSop", "onboardingSheet"] as const) {
      const index = header.identities[field];
      if (index !== undefined) columns.add(index);
    }
    for (const stage of header.stages) columns.add(stage.index);
  }
  return [...columns].sort((left, right) => left - right);
}

export function parseGmbManagementWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceTab: string,
): GmbOperationItem[] {
  return walkBlocks(rows).flatMap(({ row, rowIndex, header, section }) => {
    const client = cell(row, header.identities.client);
    if (!client) return [];

    const parsedStages = header.stages.map((definition) => {
      const rawOutput = cell(row, definition.index);
      const rawStatus = cell(row, definition.statusIndex);
      const outputIsStatus = definition.statusIndex === null && normalizeGmbStageState(rawOutput) !== null;
      const output = outputIsStatus ? null : rawOutput;
      return {
        key: definition.key,
        label: definition.label,
        sourceLabel: definition.sourceLabel,
        state: stageState(rawStatus, rawOutput),
        rawStatus: rawStatus ?? (outputIsStatus ? rawOutput : null),
        output,
        outputUrl: findHttpUrl(output),
      } satisfies GmbWorkflowStage;
    });
    const contentStage = parsedStages.find((stage) => stage.key === "content");
    const postingStage = parsedStages.find((stage) => stage.key === "posting");
    if (!contentStage || !postingStage) return [];
    const notes = cell(row, header.identities.notes);

    // A populated client alone can be a section/template row. A real workflow
    // record must carry at least one stage value or status from the source.
    if (![contentStage.output, contentStage.rawStatus, postingStage.output, postingStage.rawStatus].some(Boolean)) return [];

    return [{
      id: `${sourceTab}::${section}::${rowIndex}`,
      sourceTab,
      sourceSection: section,
      client,
      clientUrl: findHttpUrl(client),
      email: cell(row, header.identities.email),
      loginUrl: findHttpUrl(cell(row, header.identities.login)),
      orderNumber: cell(row, header.identities.orderNumber),
      seoPackage: cell(row, header.identities.seoPackage),
      primaryKeyword: cell(row, header.identities.primaryKeyword),
      city: cell(row, header.identities.city),
      promptSopUrl: findHttpUrl(cell(row, header.identities.promptSop)),
      onboardingSheetUrl: findHttpUrl(cell(row, header.identities.onboardingSheet)),
      notes,
      contentStage,
      postingStage,
      normalizedStatus: overallStatus([contentStage, postingStage], notes),
    }];
  });
}

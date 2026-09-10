/** Source-owned before/after evidence. No numeric progress: applicability is not recorded. */
export type TechnicalSeoResource = { label: string; outputUrl: string };
export type TechnicalSeoEvidence = {
  key: string;
  label: string;
  phase: string;
  output: string | null;
  outputUrl: string | null;
  rawStatus: string | null;
};
export type TechnicalSeoPhase = { label: string; status: string };
export type TechnicalSeoItem = {
  id: string;
  client: string;
  clientUrl: string | null;
  seoPackage: string | null;
  assignedVa: string | null;
  orderNumber: string | null;
  primaryKeyword: string | null;
  city: string | null;
  sourceTab: string;
  sourceSection: string;
  sourceRow: number;
  evidence: TechnicalSeoEvidence[];
  phases: TechnicalSeoPhase[];
  notes: { label: string; value: string }[];
  resources: TechnicalSeoResource[];
  status: string;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const valueAt = (row: readonly string[], index: number) => row[index]?.trim() || null;
const isStatusHeader = (value: string) => /^status(?:\s*\d+)?$/i.test(value.trim());
const evidenceHeader = /^(technical|mobile|desktop|ranking)\s+(before|after)$|^current ranking$/i;
const noteHeader = /^(notes?|bottleneck|actions?|remarks)$/i;
const na = /^(n\/?a|not applicable|not required|[-–—])$/i;
const blocking = /\b(stuck|blocked|need(?:s)? login credentials)\b/i;

export function technicalSeoUrl(value: string | null): string | null {
  const candidate = value?.match(/https?:\/\/[^\s]+/i)?.[0];
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : null;
  } catch { return null; }
}

/** Preserve unknown source states; only spelling/equivalent completion labels normalize. */
export function technicalSeoStatus(raw: string | null): string | null {
  if (!raw || na.test(raw)) return null;
  const text = normalize(raw);
  if (["done", "complete", "completed"].includes(text)) return "Completed";
  if (["cancel", "cancelled", "canceled"].includes(text)) return "Cancelled";
  if (text === "blocked" || text === "stuck") return "Stuck";
  if (["paused", "on hold"].includes(text)) return "Paused";
  if (text === "in progress") return "In Progress";
  return raw.trim();
}

export function credibleTechnicalSeoAssignee(raw: string | null): string | null {
  if (!raw || raw.length > 60 || !/^[\p{L}][\p{L}\s.'’-]*$/u.test(raw)) return null;
  if (/\b(done|completed?|cancel(?:led|ed)?|stuck|blocked|paused|pending|waiting|progress|assigned|unassigned|none|team|technical|seo|login|credentials|need|not|working|ongoing|va|n\/a)\b/i.test(raw)) return null;
  return raw.trim();
}

type EvidenceColumn = { index: number; statusIndex: number; label: string; phase: string };
type Header = { cells: readonly string[]; clientIndex: number; evidence: EvidenceColumn[] };

function readHeader(row: readonly string[]): Header | null {
  const clientIndex = row.findIndex((v) => /^(name|client|website url)$/i.test(v.trim()));
  const evidence: EvidenceColumn[] = [];
  row.forEach((raw, index) => {
    const label = raw.trim();
    if (!evidenceHeader.test(label)) return;
    const phase = /^current ranking$/i.test(label) ? "Ranking" : label.split(/\s+/)[0]!;
    // Legacy before/after pairs share one phase status. Modern fields each own an adjacent status.
    const statusIndex = isStatusHeader(row[index + 1] ?? "") ? index + 1
      : evidenceHeader.test(row[index + 1]?.trim() ?? "") && isStatusHeader(row[index + 2] ?? "") ? index + 2 : -1;
    evidence.push({ index, statusIndex, label, phase: phase[0]!.toUpperCase() + phase.slice(1).toLowerCase() });
  });
  return clientIndex >= 0 && evidence.length > 0 ? { cells: row, clientIndex, evidence } : null;
}

export function locateTechnicalSeoLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>([0]); // section-level SOP/KPI resources
  for (const row of rows) {
    const header = readHeader(row);
    if (!header) continue;
    columns.add(header.clientIndex);
    for (const field of header.evidence) columns.add(field.index);
    header.cells.forEach((name, index) => {
      if (/^(logins?|report folder|prompt\s*\/\s*sop|daily output)$/i.test(name.trim())) columns.add(index);
    });
  }
  return [...columns].sort((a, b) => a - b);
}

/** Blank states mean unrecorded, never failed. Links alone never mean completed.
 * Attention precedence: Stuck > Paused > Cancelled > unrecognized explicit state >
 * all fields explicitly complete > partial evidence/work > Not recorded.
 * Explicit N/A is excluded. Entirely blank phases remain Not recorded.
 */
export function summarizeTechnicalSeoEvidence(evidence: readonly TechnicalSeoEvidence[]): string {
  const relevant = evidence.filter((field) => !na.test(field.rawStatus ?? field.output ?? ""));
  const states = relevant.map((field) => technicalSeoStatus(field.rawStatus));
  for (const state of ["Stuck", "Paused", "Cancelled"]) if (states.includes(state)) return state;
  const other = states.find((state) => state && !["Completed", "In Progress"].includes(state));
  if (other) return other;
  if (relevant.length > 0 && states.every((state) => state === "Completed")) return "Completed";
  if (relevant.some((field) => field.output || field.rawStatus)) return "In Progress";
  return "Not recorded";
}

export function parseTechnicalSeoWorkflowRows(rows: readonly (readonly string[])[], sourceTab: string): TechnicalSeoItem[] {
  const headers = rows.map(readHeader);
  let header: Header | null = null;
  let section = "Technical SEO";
  let pendingSection: string | null = null;
  let block = 0;
  const items: TechnicalSeoItem[] = [];
  rows.forEach((row, index) => {
    const matched = headers[index];
    if (matched) {
      header = matched;
      block++;
      section = pendingSection ?? `Technical SEO (block ${block})`;
      pendingSection = null;
      return;
    }
    const populated = row.filter((v) => v.trim());
    if (!populated.length) return;
    // A one-cell client is still a client. Only a title immediately preceding a header is a section.
    const nextIndex = rows.findIndex((next, j) => j > index && next.some((v) => v.trim()));
    if (populated.length === 1 && nextIndex >= 0 && headers[nextIndex]) {
      pendingSection = populated[0]!.trim();
      return;
    }
    if (!header) return;
    const activeHeader = header;
    const client = valueAt(row, activeHeader.clientIndex);
    if (!client) return;
    const first = (pattern: RegExp) => {
      for (let c = 0; c < activeHeader.cells.length; c++) {
        if (pattern.test(activeHeader.cells[c]!.trim()) && valueAt(row, c)) return valueAt(row, c);
      }
      return null;
    };
    const evidence = activeHeader.evidence.map((field) => ({
      key: `${field.index}`, label: field.label, phase: field.phase,
      output: valueAt(row, field.index), outputUrl: technicalSeoUrl(valueAt(row, field.index)),
      rawStatus: valueAt(row, field.statusIndex),
    }));
    const notes = activeHeader.cells.flatMap((label, c) => {
      const value = valueAt(row, c);
      if (!noteHeader.test(label.trim()) || !value) return [];
      const phase = activeHeader.evidence.filter((field) => field.index < c).at(-1)?.phase;
      return [{ label: `${phase ? `${phase} · ` : ""}${label.trim()}`, value }];
    });
    const resources = evidence.flatMap((field) => field.outputUrl ? [{ label: field.label, outputUrl: field.outputUrl }] : []);
    for (const [pattern, label] of [
      [/^logins?$/i, "Login document"], [/^report folder$/i, "Report folder"],
      [/^prompt\s*\/\s*sop$/i, "Prompt / SOP"], [/^daily output$/i, "Daily output"],
    ] as const) {
      const url = technicalSeoUrl(first(pattern));
      if (url) resources.push({ label, outputUrl: url });
    }
    // Daily output sometimes carries a work-log/blocker sentence instead of a link (e.g. "Login credentials",
    // "Website problem"); a non-URL value is real source-owned blocker text and must surface, not be dropped.
    const dailyOutputText = first(/^daily output$/i);
    if (dailyOutputText && !technicalSeoUrl(dailyOutputText)) notes.push({ label: "Daily output", value: dailyOutputText });
    const sectionUrl = technicalSeoUrl(section);
    if (sectionUrl) resources.push({ label: "Section resource", outputUrl: sectionUrl });
    const clientUrl = technicalSeoUrl(client);
    const phases = [...new Set(evidence.map((field) => field.phase))].map((label) => ({
      label, status: summarizeTechnicalSeoEvidence(evidence.filter((field) => field.phase === label)),
    }));
    items.push({
      id: `${sourceTab}::${index + 1}`, client, clientUrl,
      seoPackage: first(/^(seo package|package)$/i),
      assignedVa: activeHeader.cells.reduce<string | null>((found, name, c) => found ?? (/^(assigned va|assigned|assignee)$/i.test(name.trim()) ? credibleTechnicalSeoAssignee(valueAt(row, c)) : null), null),
      orderNumber: first(/^(order\s*#|seo order#)$/i),
      primaryKeyword: first(/^primary keyword$/i), city: first(/^city$/i),
      sourceTab, sourceSection: section, sourceRow: index + 1, evidence, phases, notes, resources,
      status: notes.some((note) => blocking.test(note.value)) ? "Stuck" : summarizeTechnicalSeoEvidence(evidence),
    });
  });
  return items;
}

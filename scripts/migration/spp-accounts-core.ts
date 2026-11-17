import { createHash } from "node:crypto";
import { provisionClientAccountSchema } from "../../src/domain/permissions/schema";

export const WOLF_TENANT = "f0f0f0f0-0000-4000-8000-000000000001";
const PRODUCTION = "jwynqsyirgenqlmkooah";
export type AccountRow = Record<string, string>;
export type ImportFields = { email: string; display_name: string; company_name: string; phone: string | null; stripe_customer_id: string | null };
export type Receipt = { tenant_id: string; state: string };
export type ImportBackend = {
  wolfTenant: string;
  inspect(): Promise<Receipt>;
  claim(id: string, emailHash: string): Promise<Receipt>;
  createUser(fields: ImportFields): Promise<string>;
  complete(id: string, userId: string, fields: ImportFields): Promise<Receipt>;
  verify(id: string): Promise<Receipt>;
};
export type Options = { apply?: boolean; projectRef?: string; url?: string; onlyEmails?: Set<string> };
export function guardTarget(options: Options): string {
  try {
    const url = new URL(options.url ?? "");
    const ref = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname)?.[1];
    if (!ref || ref === PRODUCTION || options.projectRef === PRODUCTION || ref !== options.projectRef ||
      url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return ref;
  } catch { throw new Error("Import target refused."); }
}
export function credentialLike(value: string): boolean {
  return /\b(?:password|passwd|passphrase|access_token|refresh_token|api_key|secret_key)\s*[:=]\s*\S{6,}|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value);
}
export async function runImport(rows: Iterable<AccountRow> | AsyncIterable<AccountRow>, options: Options = {}, backend?: ImportBackend) {
  const counts = { rows: 0, would_create: 0, would_skip_already_imported: 0, rejected: 0, created: 0, duplicate_emails: 0, duplicate_ids: 0, filtered_out: 0, not_attempted: 0, database_state_checked: 0, reasons: {} as Record<string, number> };
  const reject = (reason: string) => { counts.rejected++; counts.reasons[reason] = (counts.reasons[reason] ?? 0) + 1; };
  const check = (receipt: Receipt) => { if (receipt.tenant_id !== WOLF_TENANT || backend?.wolfTenant !== WOLF_TENANT) throw new Error("Import tenant refused."); };
  if (options.apply) { guardTarget(options); if (!backend) throw new Error("Import backend unavailable."); }
  // Consume and validate EOF before any external side effect. Keep only the
  // allowlisted Account fields in ephemeral memory; never spool client rows.
  const buffered: AccountRow[]=[]; const identities=new Map<string,string>(); const conflicts=new Set<string>();
  for await (const source of rows) {
    const row=Object.fromEntries(["id","email","name_f","name_l","company","phone","stripe_customer_id"].map(k=>[k,source[k] ?? ""]));
    const id=row.id!.trim(); const email=row.email!.trim().toLowerCase();
    if (identities.has(id) && identities.get(id)!==email) conflicts.add(id);
    identities.set(id,email); buffered.push(row);
  }
  const pilot = options.onlyEmails && new Set([...options.onlyEmails].map(v => v.trim().toLowerCase()));
  const ids = new Set<string>(); const emails = new Set<string>();
  const candidates: {id:string;fields:ImportFields}[]=[];
  for (const row of buffered) {
    counts.rows++;
    const email = row.email!.trim().toLowerCase();
    if (pilot && !pilot.has(email)) { counts.filtered_out++; continue; }
    const id = row.id!.trim();
    if (!/^[1-9]\d{0,63}$/.test(id)) { reject("invalid_source_id"); continue; }
    if (conflicts.has(id)) { reject("conflicting_source_id"); continue; }
    if (ids.has(id)) { counts.duplicate_ids++; continue; }
    const first = row.name_f!.trim(); const last = row.name_l!.trim();
    const fullName = [first,last].filter(Boolean).join(" ");
    const company = row.company!.trim() || fullName;
    if (!company) { reject("missing_company"); continue; }
    const fields: ImportFields = { email, display_name: fullName || company, company_name: company, phone: row.phone?.trim() || null, stripe_customer_id: row.stripe_customer_id?.trim() || null };
    if (Object.values(fields).some(v => v && credentialLike(v))) { reject("credential_content"); continue; }
    const parsed = provisionClientAccountSchema.safeParse({ ...fields, first_name:first || null, last_name:last || null });
    if (!parsed.success || (fields.stripe_customer_id && !/^cus_[A-Za-z0-9]{1,128}$/.test(fields.stripe_customer_id))) { reject("invalid_fields"); continue; }
    ids.add(id);
    const duplicateEmail=emails.has(email);
    if (duplicateEmail) counts.duplicate_emails++;
    emails.add(email);
    if (!options.apply) { if (!duplicateEmail) counts.would_create++; continue; }
    // Even duplicate-email source IDs reach the durable collision check.
    candidates.push({id,fields});
  }
  if (!options.apply) return counts;
  const api=backend!; check(await api.inspect()); counts.database_state_checked=1;
  for (const [index,{id,fields}] of candidates.entries()) {
    try {
      const claim=await api.claim(id,createHash("sha256").update(fields.email).digest("hex")); check(claim);
      if (claim.state==="complete") { counts.would_skip_already_imported++; continue; }
      if (claim.state!=="claimed") throw new Error();
      // Pending/uncertain outcomes stop the batch and require manual review.
      const userId=await api.createUser(fields);
      const completed=await api.complete(id,userId,fields); check(completed);
      if (completed.state!=="complete") throw new Error();
      const verified=await api.verify(id); check(verified);
      if (verified.state!=="complete") throw new Error();
      counts.created++;
    } catch { reject("manual_review"); counts.not_attempted=candidates.length-index-1; break; }
  }
  return counts;
}
/** Streaming RFC-4180 subset: BOM, CRLF, embedded newlines and escaped quotes. */
export async function* parseCsv(chunks: AsyncIterable<string>, requiredHeaders: string[] = []): AsyncGenerator<AccountRow> {
  let headers: string[] | undefined; let row: string[] = []; let field = "";
  let quoted = false; let afterQuote = false; let first = true; let skipLF = false;
  const finishRow = () => {
    row.push(field); field = "";
    const cells = row; row = [];
    if (!headers) {
      if (cells.some(c => !c) || new Set(cells).size !== cells.length || requiredHeaders.some(h=>!cells.includes(h)) || cells.some(c => /password|passwd|token|card.?number|cvv|cvc|^field_value$|^field_name$/i.test(c))) throw new Error("CSV header refused.");
      headers = cells; return undefined;
    }
    if (cells.length !== headers.length) throw new Error("CSV row shape refused.");
    return Object.fromEntries(headers.map((h,i) => [h,cells[i]!])) as AccountRow;
  };
  for await (const chunk of chunks) {
    if (typeof chunk !== "string") throw new Error("CSV requires decoded text chunks.");
    for (const c of chunk) {
      if (first) { first=false; if (c === "\ufeff") continue; }
      if (skipLF) { skipLF=false; if (c === "\n") continue; }
      if (quoted) {
        if (c === '"') { quoted=false; afterQuote=true; } else field+=c;
      } else if (afterQuote && c === '"') { field+='"'; quoted=true; afterQuote=false; }
      else if (c === ',') { row.push(field); field=""; afterQuote=false; }
      else if (c === '\r' || c === '\n') {
        const result=finishRow(); afterQuote=false; skipLF=c==='\r'; if (result) yield result;
      } else if (c === '"' && !field && !afterQuote) quoted=true;
      else { if (afterQuote || c==='"') throw new Error("CSV quoting refused."); field+=c; }
      if (field.length > 1_048_576 || row.length > 128) throw new Error("CSV size refused.");
    }
  }
  if (quoted) throw new Error("CSV unterminated quote.");
  if (field || row.length || afterQuote) { const result=finishRow(); if (result) yield result; }
  if (!headers) throw new Error("CSV header missing.");
}
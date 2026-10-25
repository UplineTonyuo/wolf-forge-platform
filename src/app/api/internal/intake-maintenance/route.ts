import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readServerEnvironment } from "../../../../lib/env/server-env";
import { INTAKE_FILE_BUCKET } from "../../../../lib/forms/intake-file";
import { createTrustedServerSupabaseClient } from "../../../../lib/supabase/trusted-server-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return Response.json({ ok: false, error: "Scheduled form processing is not configured." }, { status: 503 });
  const actual = Buffer.from(secret);
  const candidate = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (actual.length !== candidate.length || !timingSafeEqual(actual, candidate)) return Response.json({ ok: false, error: "Request refused." }, { status: 401 });
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const maintenance = await trusted.rpc("app_server_intake_maintenance");
  if (maintenance.error) return Response.json({ ok: false, error: "Scheduled processing could not be confirmed." }, { status: 503 });
  const batch = z.object({ reminders: z.number(), expired_drafts: z.number(), queued: z.array(z.uuid()).max(25),
    expired_files: z.array(z.object({ id: z.uuid(), path: z.string().min(1) })).max(25) }).parse(maintenance.data);
  let completed = 0;
  let removed = 0;
  for (const id of batch.queued) {
    const job = await trusted.rpc("app_server_run_intake_job", { p_submission_id: id });
    if (!job.error) completed += 1;
  }
  const bucket = trusted.storage.from(INTAKE_FILE_BUCKET);
  for (const file of batch.expired_files) {
    const prefix = file.path.slice(0,file.path.lastIndexOf("/"));
    const before = await bucket.list(prefix, { search: file.id, limit: 2 });
    if (before.error) continue;
    if (before.data.some((item) => item.name === file.id)) {
      const deletion = await bucket.remove([file.path]);
      if (deletion.error) continue;
    }
    // Reconcile a prior deletion before retrying it, then confirm its result.
    const remaining = await bucket.list(prefix, { search: file.id, limit: 2 });
    if (remaining.error || remaining.data.some((item) => item.name === file.id)) continue;
    const finish = await trusted.rpc("app_server_finish_expired_intake_file", { p_id: file.id });
    if (!finish.error) removed += 1;
  }
  return Response.json({ ok: true, reminders: batch.reminders, expiredDrafts: batch.expired_drafts, processedJobs: completed, removedFiles: removed },
    { headers: { "Cache-Control": "private, no-store" } });
}

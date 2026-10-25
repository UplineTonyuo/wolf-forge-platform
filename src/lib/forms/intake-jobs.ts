import "server-only";
import { z } from "zod";
import { readServerEnvironment } from "../env/server-env";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";
import { mapDatabaseError } from "../errors/map-database-error";

export async function runIntakeSubmissionJob(submissionId: string) {
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const response = await trusted.rpc("app_server_run_intake_job", { p_submission_id: submissionId });
  if (response.error) throw mapDatabaseError(response.error, "Submission follow-up");
  return z.object({ status: z.enum(["not_required", "queued", "completed", "blocked"]) }).parse(response.data).status;
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { GOAL_PHOTO_BUCKET, GOAL_PHOTO_MAX_BYTES } from "../../../../../domain/goals/schema";
import { readServerEnvironment } from "../../../../../lib/env/server-env";
import { ValidationError, toClientSafeError } from "../../../../../lib/errors/application-error";
import { validateAvatarBytes } from "../../../../../lib/images/avatar-file";
import { readBoundedBytes } from "../../../../../lib/security/bounded-text";
import { requestIsSameOrigin } from "../../../../../lib/security/same-origin";
import { getVerifiedSessionContext } from "../../../../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../../../../lib/supabase/trusted-server-client";
import { GoalRepository } from "../../../../../repositories/goal-repository";
import { TicketAttachmentStorageRepository } from "../../../../../repositories/ticket-attachment-storage-repository";
import { GoalService } from "../../../../../services/goal-service";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer" };
type Params = { params: Promise<{ goalId: string }> };
function failure(error: unknown) {
  const safe = toClientSafeError(error);
  return Response.json({ ok: false, error: safe.message }, { status: safe.code === "RATE_LIMITED" ? 429 : safe.code === "PERMISSION_DENIED" ? 403 : safe.code === "VALIDATION_ERROR" ? 400 : safe.code === "DATABASE_ERROR" ? 503 : 404, headers: privateHeaders });
}
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await getVerifiedSessionContext(false);
    if (!context) return new Response("Sign in to view this photo.", { status: 401, headers: privateHeaders });
    const id = z.uuid().parse((await params).goalId), repository = new GoalRepository(context.client);
    const photo = await repository.photoContext(id);
    if (!photo.photo_path || !photo.photo_size || photo.photo_size > GOAL_PHOTO_MAX_BYTES) throw new ValidationError("Photo is unavailable.");
    const storage = new TicketAttachmentStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment()), GOAL_PHOTO_BUCKET);
    const blob = await storage.download(photo.photo_path);
    if (blob.size > GOAL_PHOTO_MAX_BYTES) throw new ValidationError("Photo is unavailable.");
    const bytes = new Uint8Array(await blob.arrayBuffer()), checked = validateAvatarBytes(bytes);
    if (!checked.ok || bytes.length !== photo.photo_size || checked.format.mimeType !== photo.photo_mime ||
      createHash("sha256").update(bytes).digest("hex") !== photo.photo_checksum) throw new ValidationError("Photo is unavailable.");
    const current = await repository.get(id);
    if (current.photo_path !== photo.photo_path) throw new ValidationError("Photo changed. Reload this goal.");
    return new Response(bytes, { headers: { ...privateHeaders, "Content-Type": checked.format.mimeType, "Content-Length": String(bytes.length) } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Params) {
  if (!requestIsSameOrigin(request)) return new Response("Request refused.", { status: 403, headers: privateHeaders });
  try {
    const context = await getVerifiedSessionContext(false);
    if (!context) return new Response("Sign in to update this goal.", { status: 401, headers: privateHeaders });
    const id = z.uuid().parse((await params).goalId);
    const storage = new TicketAttachmentStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment()), GOAL_PHOTO_BUCKET);
    const goal = await new GoalService(new GoalRepository(context.client), storage).uploadPhoto(id, async () => {
      const body = await readBoundedBytes(request, GOAL_PHOTO_MAX_BYTES, 20_000);
      if (!body.ok) throw new ValidationError(body.status === 413 ? "Photo must be 2 MB or smaller." : "Photo upload was interrupted. Try again.");
      return body.value;
    }, context.actor);
    revalidatePath("/team/goals"); revalidatePath("/team/goals/" + id);
    return Response.json({ ok: true, goal }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}

import { z } from "zod";

export const CLIENT_SUPPORT_COOKIE = "wf-client-support";
export const CLIENT_SUPPORT_EXIT_COOKIE = "wf-client-support-exit";
export const CLIENT_SUPPORT_HEADER = "x-wf-client-support";
export const CLIENT_SUPPORT_SECONDS = 15 * 60;
export const clientSupportTokenSchema = z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/);
export const clientSupportStateSchema = z.object({ id: z.uuid(), active: z.boolean() }).nullable();
export const clientSupportProofSchema = z.object({
  id: z.uuid(),
  administratorId: z.uuid(),
  clientId: z.uuid(),
  tenantId: z.uuid(),
  companyId: z.uuid(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  companyName: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ClientSupportProof = z.infer<typeof clientSupportProofSchema>;

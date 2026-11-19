import { z } from "zod";

export const sections = ["orders","tickets","clients","messaging","saved-replies","tags"] as const;
export type ProcessSection = (typeof sections)[number];
export const sectionTitle: Record<ProcessSection,string> = {
  orders:"Orders", tickets:"Tickets", clients:"Clients", messaging:"Messaging", "saved-replies":"Saved replies", tags:"Tags",
};
export const processEntrySchema = z.object({ key:z.string().min(1).max(48), name:z.string().trim().min(1).max(80),
  description:z.string().max(4000), color:z.string().regex(/^#[0-9a-f]{6}$/i) });
export type ProcessEntry = z.infer<typeof processEntrySchema>;
export const savedReplySchema = processEntrySchema.omit({color:true});
export const configSchema = z.object({
  entries:z.array(processEntrySchema).max(150), lock:z.boolean().optional(), reopen:z.boolean().optional(),
  destination:z.string().max(48).optional(), ratings:z.boolean().optional(), reply:z.string().max(48).optional(),
  ownerOnly:z.boolean().optional(), automatic:z.boolean().optional(), body:z.string().max(4000).optional(),
  days:z.array(z.number().int().min(1).max(7)).max(7).optional(), start:z.string().optional(), end:z.string().optional(), zone:z.string().max(100).optional(),
}).strict();
export type ProcessConfig = z.infer<typeof configSchema>;
export const snapshotSchema = z.object({version:z.number().int().nonnegative(), settings:configSchema});
export function orderStage(entries: ProcessEntry[], status: string, custom?: string | null) {
  return entries.find(entry => entry.key === (custom ?? status));
}
export function canManageProcess(role: string) { return role === "admin" || role === "owner"; }


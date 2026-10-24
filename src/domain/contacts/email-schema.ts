import { z } from "zod";

export const contactEmailSchema = z.object({
  contactId: z.uuid(), requestId: z.uuid(),
  recipientEmail: z.email(),
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), "Use a single-line subject."),
  body: z.string().trim().min(1).max(50_000),
});
export type ContactEmailInput = z.infer<typeof contactEmailSchema>;
export type ContactEmailOutcome = "accepted" | "sending" | "uncertain" | "recipient_changed";

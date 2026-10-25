import { z } from "zod";

export const requestAutomationSchema = z.object({
  create_project: z.boolean().default(false),
  service_id: z.uuid().nullable().optional(),
  project_title: z.string().trim().min(1).max(200).optional(),
  task_title: z.string().trim().min(1).max(200).nullable().optional(),
  crm_status: z.enum(["contact", "lead", "client", "client_team"]).nullable().optional(),
  workflow_steps: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).strict().refine((value) => !value.create_project || (value.service_id && value.project_title), {
  message: "Choose a Service and project title for automatic project creation.",
});

export const formReminderDaysSchema = z.number().int().min(0).max(30);

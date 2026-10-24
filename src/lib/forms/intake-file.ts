import { z } from "zod";

export const INTAKE_FILE_BUCKET = "intake-files";
export const INTAKE_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const INTAKE_FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
export const intakeFileSchema = z.object({ id: z.uuid(), name: z.string(), mime: z.string(), size: z.number().int().positive(), path: z.string().min(1) });

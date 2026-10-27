import { z } from "zod";
import { orderStatuses } from "./schema";
export const clientOrderStartSchema = z.object({
  order_id: z.uuid(), status: z.enum(orderStatuses), requested: z.boolean(), started: z.boolean(), available: z.boolean(),
  forms: z.array(z.object({ id: z.uuid(), title: z.string(), completed: z.boolean(), available: z.boolean() })).max(500),
}).strict();
export type ClientOrderStartState = z.infer<typeof clientOrderStartSchema>;

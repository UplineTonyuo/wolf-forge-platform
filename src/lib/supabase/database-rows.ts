import type { Tables } from "./database.types.js";

// PostgreSQL type generation cannot infer literal unions from CHECK
// constraints over text columns, so domain-facing aliases refine those fields.
export type RoleRow = Tables<"roles">;
export type ProfileRow = Tables<"profiles">;
export type CompanyRow = Tables<"companies">;
export type ClientContactRow = Tables<"client_contacts">;
export type ServiceRow = Tables<"services">;
export type ActivityEventRow = Omit<Tables<"activity_events">, "entity_type"> & {
  entity_type: "company" | "client_contact" | "service" | "order" | "order_task" | "profile";
};
export type OrderRow = Omit<Tables<"orders">, "status" | "priority"> & {
  status: "pending" | "submitted" | "working" | "waiting_reply" | "pending_update" | "complete" | "canceled";
  priority: "low" | "normal" | "high" | "urgent";
};
export type OrderTaskRow = Omit<Tables<"order_tasks">, "status"> & {
  status: "todo" | "in_progress" | "blocked" | "complete" | "canceled";
};

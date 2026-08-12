import { describe, expect, it } from "vitest";
import { createCompanySchema } from "../domain/companies/schema.js";
import { createContactSchema } from "../domain/contacts/schema.js";
import { createOrderSchema, orderPriorities, orderStatuses } from "../domain/orders/schema.js";
import { createServiceSchema } from "../domain/services/schema.js";
import { createTaskSchema, taskStatuses } from "../domain/tasks/schema.js";

const id = "10000000-0000-4000-8000-000000000001";

describe("Phase 1 input validation", () => {
  it("rejects blank company names", () => {
    expect(createCompanySchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("validates contact company IDs and optional nonblank values", () => {
    expect(createContactSchema.safeParse({ company_id: "bad", name: "Contact" }).success).toBe(false);
    expect(createContactSchema.safeParse({ company_id: id, name: "Contact", email: "" }).success).toBe(false);
    expect(createContactSchema.safeParse({ company_id: id, name: "Contact", email: null }).success).toBe(true);
  });

  it("rejects blank services", () => {
    expect(createServiceSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createServiceSchema.safeParse({ name: "Fulfillment" }).success).toBe(true);
  });

  it("matches the database order status and priority vocabulary", () => {
    expect(orderStatuses).toEqual(["pending", "submitted", "working", "waiting_reply", "pending_update", "complete", "canceled"]);
    expect(orderPriorities).toEqual(["low", "normal", "high", "urgent"]);
    expect(createOrderSchema.safeParse({ company_id: id, service_id: id, title: "Order", priority: "critical" }).success).toBe(false);
  });

  it("matches task statuses and rejects negative positions", () => {
    expect(taskStatuses).toEqual(["todo", "in_progress", "blocked", "complete", "canceled"]);
    expect(createTaskSchema.safeParse({ order_id: id, title: "Task", sort_position: -1 }).success).toBe(false);
  });
});

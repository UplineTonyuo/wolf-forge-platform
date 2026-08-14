import { describe, expect, it } from "vitest";
import { createCompanySchema } from "../domain/companies/schema";
import { createContactSchema } from "../domain/contacts/schema";
import { createOrderSchema, orderPriorities, orderStatuses } from "../domain/orders/schema";
import {
  createServiceFolderSchema,
  createServiceSchema,
  updateServiceSchema,
} from "../domain/services/schema";
import { createTaskSchema, taskStatuses } from "../domain/tasks/schema";

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

  it("validates service folder nesting inputs", () => {
    expect(createServiceFolderSchema.safeParse({ name: "SEO Sprints", parent_id: id }).success).toBe(true);
    expect(createServiceFolderSchema.safeParse({ name: " ", sort_order: -1 }).success).toBe(false);
  });

  it("requires complete recurring service configuration", () => {
    expect(createServiceSchema.safeParse({
      name: "Incomplete recurrence",
      recurring: true,
      price: 97,
    }).success).toBe(false);
    expect(createServiceSchema.safeParse({
      name: "Monthly sprint",
      recurring: true,
      price: 97,
      recurring_price: 97,
      recurring_interval_length: 1,
      recurring_interval_unit: "M",
      recurring_action: "reopen_order",
    }).success).toBe(true);
    expect(updateServiceSchema.safeParse({
      recurring: false,
      recurring_price: 97,
      recurring_interval_length: null,
      recurring_interval_unit: null,
      recurring_action: null,
    }).success).toBe(false);
  });

  it("validates service folder assignment and fulfillment timing", () => {
    expect(createServiceSchema.safeParse({ name: "Assigned", folder_id: id, deadline_amount: 2, deadline_unit: "D" }).success).toBe(true);
    expect(createServiceSchema.safeParse({ name: "Missing deadline unit", deadline_amount: 2 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ name: "Bad folder", folder_id: "not-a-uuid" }).success).toBe(false);
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

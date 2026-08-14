import type { Tables } from "./database.types";

// PostgreSQL type generation cannot infer literal unions from CHECK
// constraints over text columns, so domain-facing aliases refine those fields.
export type RoleRow = Tables<"roles">;
export type ProfileRow = Tables<"profiles">;
export type CompanyRow = Tables<"companies">;
export type CompanyWalletRow = Tables<"company_wallets">;
export type CompanyWalletTransactionRow = Tables<"company_wallet_transactions">;
export type WfCardMembershipRow = Tables<"wf_card_memberships">;
export type ClientContactRow = Tables<"client_contacts">;
export type ServiceRow = Tables<"services">;
export type ServiceFolderRow = Tables<"service_folders">;
export type CouponRow = Omit<Tables<"coupons">, "discount_type" | "recurring_duration"> & {
  discount_type: "fixed" | "percentage";
  recurring_duration: "forever" | "first_payment";
};
export type CouponDiscountRuleRow = Tables<"coupon_discount_rules">;
export type CouponDiscountServiceRow = Tables<"coupon_discount_services">;
export type CouponRedemptionRow = Tables<"coupon_redemptions">;
export type ActivityEventRow = Omit<Tables<"activity_events">, "entity_type"> & {
  entity_type: "company" | "client_contact" | "service_folder" | "service" | "order" | "order_task" | "profile" | "coupon" | "invoice" | "subscription" | "form" | "form_assignment" | "form_submission" | "ticket";
};
export type InvoiceRow = Omit<Tables<"invoices">, "status"> & {
  status: "draft" | "unpaid" | "payment_pending" | "paid" | "void";
};
export type InvoiceItemRow = Tables<"invoice_items">;
export type InvoicePaymentRow = Omit<Tables<"invoice_payments">, "status"> & {
  status: "pending" | "succeeded" | "failed" | "cancelled";
};
export type InvoiceRefundRow = Omit<Tables<"invoice_refunds">, "status"> & {
  status: "pending" | "succeeded" | "failed" | "cancelled";
};
export type SubscriptionRow = Omit<Tables<"subscriptions">, "status" | "plan_source"> & {
  status: "active" | "past_due" | "paused" | "pending_cancellation" | "canceled";
  plan_source: "admin_invoice" | "checkout" | "payment_link" | "service_purchase";
};
export type SubscriptionPlanVersionRow = Omit<
  Tables<"subscription_plan_versions">,
  "interval_unit" | "end_of_month_policy" | "recurring_action"
> & {
  interval_unit: "day" | "week" | "month" | "year";
  end_of_month_policy: "clamp" | "skip";
  recurring_action: "none" | "reopen_order" | "create_order" | "client_request";
};
export type SubscriptionPlanItemRow = Omit<
  Tables<"subscription_plan_items">,
  "coupon_recurring_duration"
> & {
  coupon_recurring_duration: "forever" | "first_payment" | null;
};
export type SubscriptionCycleRow = Omit<
  Tables<"subscription_cycles">,
  "status" | "fulfillment_status" | "fulfillment_action"
> & {
  status: "scheduled" | "invoiced" | "paid" | "past_due" | "voided" | "skipped";
  fulfillment_status: "not_ready" | "pending" | "deferred" | "completed" | "not_applicable";
  fulfillment_action: "none" | "reopen_order" | "create_order" | "client_request";
};
export type SubscriptionEventRow = Omit<Tables<"subscription_events">, "event_type" | "actor_type"> & {
  event_type:
    | "created"
    | "cycle_scheduled"
    | "invoice_generated"
    | "payment_settled"
    | "payment_failed"
    | "past_due"
    | "recovered"
    | "paused"
    | "resumed"
    | "cancellation_scheduled"
    | "cancellation_removed"
    | "canceled"
    | "terms_changed"
    | "invoice_invalidated"
    | "fulfillment_pending";
  actor_type: "system" | "user" | "client" | "processor";
};
export type SubscriptionPaymentMethodRow = Omit<Tables<"subscription_payment_methods">, "provider"> & {
  provider: "manual" | "wallet" | "wf_card" | "stripe" | "paypal" | "other";
};
export type SubscriptionDunningAttemptRow = Omit<Tables<"subscription_dunning_attempts">, "outcome"> & {
  outcome: "succeeded" | "failed" | "skipped" | null;
};
export type OrderRow = Omit<Tables<"orders">, "status" | "priority"> & {
  status: "pending" | "submitted" | "working" | "waiting_reply" | "pending_update" | "complete" | "canceled";
  priority: "low" | "normal" | "high" | "urgent";
};
export type OrderTaskRow = Omit<Tables<"order_tasks">, "status"> & {
  status: "todo" | "in_progress" | "blocked" | "complete" | "canceled";
};
export type FormRow = Omit<Tables<"forms">, "form_type" | "status" | "visibility"> & {
  form_type: "order" | "contact" | "intake" | "onboarding";
  status: "draft" | "published" | "inactive" | "archived";
  visibility: "public" | "authenticated" | "assigned";
};
export type FormVersionRow = Omit<Tables<"form_versions">, "lifecycle_state" | "visibility"> & {
  lifecycle_state: "draft" | "published" | "archived";
  visibility: "public" | "authenticated" | "assigned";
};
export type FormVersionFieldRow = Omit<Tables<"form_version_fields">, "field_type"> & {
  field_type:
    | "optgroup" | "dropdown" | "fullname" | "email" | "password" | "address"
    | "phone" | "optin" | "payment" | "text" | "textarea" | "richtext"
    | "date" | "checkbox" | "data-option-group" | "data-dropdown" | "file"
    | "data-spreadsheet" | "secret" | "hidden" | "signature" | "calendly"
    | "break" | "pagebreak" | "html" | "captcha";
};
export type FormFieldOptionRow = Tables<"form_field_options">;
export type FormRuleRow = Omit<Tables<"form_rules">, "action"> & {
  action: "show" | "hide";
};
export type FormServiceLinkRow = Omit<Tables<"form_service_links">, "role"> & {
  role: "offered_item" | "default_item" | "intake_assignment";
};
export type FormAssignmentRow = Omit<Tables<"form_assignments">, "assignment_type" | "status"> & {
  assignment_type: "intake" | "onboarding";
  status: "assigned" | "submitted" | "archived" | "canceled";
};
export type FormSubmissionRow = Omit<Tables<"form_submissions">, "orchestration_status"> & {
  orchestration_status: "not_applicable" | "deferred" | "completed" | "failed";
};
export type FormSubmissionValueRow = Tables<"form_submission_values">;
export type FormFileRow = Tables<"form_files">;
export type TicketRow = Omit<Tables<"tickets">, "status" | "priority"> & {
  status: "open" | "in_progress" | "waiting_on_client" | "waiting_on_team" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
};
export type TicketMessageRow = Omit<Tables<"ticket_messages">, "author_type" | "message_kind" | "visibility"> & {
  author_type: "internal" | "client" | "guest" | "system";
  message_kind: "initial_request" | "reply" | "internal_note";
  visibility: "client" | "internal";
};
export type TicketAttachmentRow = Omit<Tables<"ticket_attachments">, "scan_status"> & {
  scan_status: "pending" | "clean" | "rejected";
};

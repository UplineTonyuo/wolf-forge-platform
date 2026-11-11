export const CLIENT_SUPPORT_READ_TABLES = ["profiles", "services", "service_folders", "invoices", "companies", "wf_card_memberships"] as const;

// New API operations require a review of their database authority path before delegation.
export const CLIENT_SUPPORT_RPCS = [
  "app_get_client_support_context", "app_current_tenant_membership", "app_current_user_permissions",
  "app_current_user_modules", "app_require_module_access", "app_get_client_account_context", "app_get_my_profile",
  "app_get_runtime_white_label_configuration", "app_list_my_client_projects", "app_list_my_order_response_states", "app_get_my_client_project",
  "app_get_my_order_start", "app_my_order_chat_available", "app_request_my_order_start", "app_reconcile_my_order_start", "app_my_intake_version_available", "app_get_project_conversation",
  "app_get_published_form_schema", "app_list_assigned_forms", "app_list_form_submissions", "app_forms_work_enabled",
  "app_get_form_assignment_history", "app_get_assigned_form_schema", "app_get_assigned_form_service_labels",
  "app_submit_form", "app_get_intake_follow_up", "app_get_intake_draft", "app_save_intake_draft",
  "app_capture_intake_secret",
  "app_prepare_intake_file", "app_finish_intake_file", "app_get_intake_file", "app_get_form_submission_pdf", "app_get_form_submission",
  "app_list_ticket_summaries", "app_get_ticket_detail_with_avatars", "app_get_order_conversation", "app_get_order_conversation_page",
  "app_send_order_message", "app_reply_to_order_message", "app_toggle_order_message_reaction", "app_reply_to_ticket", "app_reply_to_ticket_message", "app_toggle_ticket_message_reaction",
  "app_create_ticket", "app_prepare_ticket_attachment", "app_send_ticket_message_with_attachment",
  "app_get_ticket_attachment_download", "app_set_client_conversation_presence",
  "app_list_my_notifications", "app_client_notification_feed", "app_open_client_notifications", "app_mark_notification_read", "app_mark_all_notifications_read",
  "app_list_my_client_reports", "app_get_my_client_report", "app_mark_client_report_read", "app_count_my_unread_reports",
  "app_invoices_work_enabled", "app_get_invoice_financials", "app_list_invoice_items", "app_get_wf_card_settings",
  "app_get_invoice_manual_payment", "app_prepare_invoice_payment_receipt", "app_get_invoice_payment_receipt", "app_submit_invoice_manual_payment_claim",
  "app_store_purchase_projects_enabled", "app_pay_invoice_with_wallet", "app_purchase_service_with_balance",
  "app_get_company_wallet", "app_list_my_wallet_history", "app_subscriptions_work_enabled",
  "app_list_subscription_summaries", "app_get_subscription_detail", "app_record_store_interest",
] as const;

export function clientSupportOperationAllowed(path: string, method: string): boolean {
  const name = path.replace(/^\/rest\/v1\//, "");
  if (name.startsWith("rpc/")) return (CLIENT_SUPPORT_RPCS as readonly string[]).includes(name.slice(4));
  return (method === "GET" || method === "HEAD") && (CLIENT_SUPPORT_READ_TABLES as readonly string[]).includes(name);
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity_events: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          summary: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          summary: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          job_title: string | null
          name: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          name: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          name?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_report_entries: {
        Row: {
          created_at: string
          id: string
          label: string
          one_time_completed: boolean
          one_time_item_key: string | null
          section_id: string
          sort_order: number
          updated_at: string
          url: string | null
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          one_time_completed?: boolean
          one_time_item_key?: string | null
          section_id: string
          sort_order?: number
          updated_at?: string
          url?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          one_time_completed?: boolean
          one_time_item_key?: string | null
          section_id?: string
          sort_order?: number
          updated_at?: string
          url?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_report_entries_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "client_report_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      client_report_reads: {
        Row: {
          profile_id: string
          read_at: string
          report_id: string
        }
        Insert: {
          profile_id: string
          read_at?: string
          report_id: string
        }
        Update: {
          profile_id?: string
          read_at?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_report_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_report_reads_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "client_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      client_report_sections: {
        Row: {
          created_at: string
          id: string
          report_id: string
          section_key: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          report_id: string
          section_key: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          report_id?: string
          section_key?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_report_sections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "client_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      client_reports: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          package_label: string
          report_lane: string
          reporting_period_month: string
          sent_at: string | null
          sent_by_profile_id: string
          service_id: string | null
          status: string
          subscription_id: string | null
          title: string
          updated_at: string
          wizard_step_key: string | null
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          package_label: string
          report_lane: string
          reporting_period_month?: string
          sent_at?: string | null
          sent_by_profile_id: string
          service_id?: string | null
          status?: string
          subscription_id?: string | null
          title: string
          updated_at?: string
          wizard_step_key?: string | null
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          package_label?: string
          report_lane?: string
          reporting_period_month?: string
          sent_at?: string | null
          sent_by_profile_id?: string
          service_id?: string | null
          status?: string
          subscription_id?: string | null
          title?: string
          updated_at?: string
          wizard_step_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reports_sent_by_profile_id_fkey"
            columns: ["sent_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reports_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reports_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_wallet_transactions: {
        Row: {
          actor_profile_id: string
          amount_cents: number
          balance_after_cents: number
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          invoice_payment_id: string | null
          reason: string | null
          request_id: string
          source: string
        }
        Insert: {
          actor_profile_id: string
          amount_cents: number
          balance_after_cents: number
          company_id: string
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string | null
          invoice_payment_id?: string | null
          reason?: string | null
          request_id: string
          source: string
        }
        Update: {
          actor_profile_id?: string
          amount_cents?: number
          balance_after_cents?: number
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string | null
          invoice_payment_id?: string | null
          reason?: string | null
          request_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_wallet_transactions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_wallet_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_wallet_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_wallet_transactions_invoice_payment_id_fkey"
            columns: ["invoice_payment_id"]
            isOneToOne: true
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      company_wallets: {
        Row: {
          balance_cents: number
          company_id: string
          created_at: string
          currency: string
          updated_at: string
        }
        Insert: {
          balance_cents?: number
          company_id: string
          created_at?: string
          currency?: string
          updated_at?: string
        }
        Update: {
          balance_cents?: number
          company_id?: string
          created_at?: string
          currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_wallets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_discount_rules: {
        Row: {
          applies_to_all: boolean
          coupon_id: string
          created_at: string
          discount_value: number
          id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          applies_to_all: boolean
          coupon_id: string
          created_at?: string
          discount_value: number
          id?: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          applies_to_all?: boolean
          coupon_id?: string
          created_at?: string
          discount_value?: number
          id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_discount_rules_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_discount_services: {
        Row: {
          coupon_discount_rule_id: string
          created_at: string
          service_id: string
        }
        Insert: {
          coupon_discount_rule_id: string
          created_at?: string
          service_id: string
        }
        Update: {
          coupon_discount_rule_id?: string
          created_at?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_discount_services_coupon_discount_rule_id_fkey"
            columns: ["coupon_discount_rule_id"]
            isOneToOne: false
            referencedRelation: "coupon_discount_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_discount_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          company_id: string | null
          coupon_id: string
          currency: string
          customer_profile_id: string | null
          customer_scope_key: string | null
          discount_amount: number
          eligible_subtotal: number
          id: string
          original_cart_subtotal: number
          redeemed_at: string
          request_id: string | null
          resulting_cart_subtotal: number
        }
        Insert: {
          company_id?: string | null
          coupon_id: string
          currency?: string
          customer_profile_id?: string | null
          customer_scope_key?: string | null
          discount_amount: number
          eligible_subtotal: number
          id?: string
          original_cart_subtotal: number
          redeemed_at?: string
          request_id?: string | null
          resulting_cart_subtotal: number
        }
        Update: {
          company_id?: string | null
          coupon_id?: string
          currency?: string
          customer_profile_id?: string | null
          customer_scope_key?: string | null
          discount_amount?: number
          eligible_subtotal?: number
          id?: string
          original_cart_subtotal?: number
          redeemed_at?: string
          request_id?: string | null
          resulting_cart_subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          archived_at: string | null
          archived_by_profile_id: string | null
          code: string
          created_at: string
          created_by_profile_id: string | null
          description: string | null
          discount_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          minimum_cart_amount: number | null
          new_customers_only: boolean
          recurring_duration: string
          single_use_per_customer: boolean
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by_profile_id?: string | null
          code: string
          created_at?: string
          created_by_profile_id?: string | null
          description?: string | null
          discount_type: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          minimum_cart_amount?: number | null
          new_customers_only?: boolean
          recurring_duration?: string
          single_use_per_customer?: boolean
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by_profile_id?: string | null
          code?: string
          created_at?: string
          created_by_profile_id?: string | null
          description?: string | null
          discount_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          minimum_cart_amount?: number | null
          new_customers_only?: boolean
          recurring_duration?: string
          single_use_per_customer?: boolean
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_archived_by_profile_id_fkey"
            columns: ["archived_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_assignments: {
        Row: {
          archived_at: string | null
          assigned_at: string
          assigned_by_profile_id: string
          canceled_at: string | null
          client_profile_id: string | null
          company_id: string
          completed_at: string | null
          due_at: string | null
          form_id: string
          form_version_id: string
          id: string
          latest_submission_id: string | null
          order_id: string | null
          required: boolean
          status: string
        }
        Insert: {
          archived_at?: string | null
          assigned_at?: string
          assigned_by_profile_id: string
          canceled_at?: string | null
          client_profile_id?: string | null
          company_id: string
          completed_at?: string | null
          due_at?: string | null
          form_id: string
          form_version_id: string
          id?: string
          latest_submission_id?: string | null
          order_id?: string | null
          required?: boolean
          status?: string
        }
        Update: {
          archived_at?: string | null
          assigned_at?: string
          assigned_by_profile_id?: string
          canceled_at?: string | null
          client_profile_id?: string | null
          company_id?: string
          completed_at?: string | null
          due_at?: string | null
          form_id?: string
          form_version_id?: string
          id?: string
          latest_submission_id?: string | null
          order_id?: string | null
          required?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_assignments_assigned_by_profile_id_fkey"
            columns: ["assigned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_client_profile_id_fkey"
            columns: ["client_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_latest_submission_fkey"
            columns: ["latest_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_version_form_fkey"
            columns: ["form_version_id", "form_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id", "form_id"]
          },
        ]
      }
      form_field_options: {
        Row: {
          created_at: string
          form_version_field_id: string
          id: string
          label: string
          metadata: Json
          option_value: string
          sort_order: number
          stable_option_key: string
        }
        Insert: {
          created_at?: string
          form_version_field_id: string
          id?: string
          label: string
          metadata?: Json
          option_value: string
          sort_order: number
          stable_option_key: string
        }
        Update: {
          created_at?: string
          form_version_field_id?: string
          id?: string
          label?: string
          metadata?: Json
          option_value?: string
          sort_order?: number
          stable_option_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_field_options_form_version_field_id_fkey"
            columns: ["form_version_field_id"]
            isOneToOne: false
            referencedRelation: "form_version_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      form_files: {
        Row: {
          checksum_sha256: string
          form_version_field_id: string
          id: string
          mime_type: string
          original_name: string
          scan_status: string
          size_bytes: number
          stable_field_key: string
          storage_object_key: string
          submission_id: string
          uploaded_at: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          checksum_sha256: string
          form_version_field_id: string
          id?: string
          mime_type: string
          original_name: string
          scan_status?: string
          size_bytes: number
          stable_field_key: string
          storage_object_key: string
          submission_id: string
          uploaded_at?: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          checksum_sha256?: string
          form_version_field_id?: string
          id?: string
          mime_type?: string
          original_name?: string
          scan_status?: string
          size_bytes?: number
          stable_field_key?: string
          storage_object_key?: string
          submission_id?: string
          uploaded_at?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_files_form_version_field_id_fkey"
            columns: ["form_version_field_id"]
            isOneToOne: false
            referencedRelation: "form_version_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_files_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_rules: {
        Row: {
          action: string
          conditions: Json
          created_at: string
          form_version_id: string
          id: string
          rule_key: string
          sort_order: number
          target_field_keys: Json
        }
        Insert: {
          action: string
          conditions: Json
          created_at?: string
          form_version_id: string
          id?: string
          rule_key: string
          sort_order: number
          target_field_keys: Json
        }
        Update: {
          action?: string
          conditions?: Json
          created_at?: string
          form_version_id?: string
          id?: string
          rule_key?: string
          sort_order?: number
          target_field_keys?: Json
        }
        Relationships: [
          {
            foreignKeyName: "form_rules_form_version_id_fkey"
            columns: ["form_version_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_service_links: {
        Row: {
          configuration: Json
          created_at: string
          form_version_field_id: string | null
          form_version_id: string
          id: string
          role: string
          service_currency_snapshot: string
          service_id: string
          service_name_snapshot: string
          service_price_cents_snapshot: number
          sort_order: number
        }
        Insert: {
          configuration?: Json
          created_at?: string
          form_version_field_id?: string | null
          form_version_id: string
          id?: string
          role: string
          service_currency_snapshot: string
          service_id: string
          service_name_snapshot: string
          service_price_cents_snapshot: number
          sort_order?: number
        }
        Update: {
          configuration?: Json
          created_at?: string
          form_version_field_id?: string | null
          form_version_id?: string
          id?: string
          role?: string
          service_currency_snapshot?: string
          service_id?: string
          service_name_snapshot?: string
          service_price_cents_snapshot?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_service_links_field_version_fkey"
            columns: ["form_version_field_id", "form_version_id"]
            isOneToOne: false
            referencedRelation: "form_version_fields"
            referencedColumns: ["id", "form_version_id"]
          },
          {
            foreignKeyName: "form_service_links_form_version_id_fkey"
            columns: ["form_version_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_service_links_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submission_values: {
        Row: {
          created_at: string
          field_label_snapshot: string
          field_type_snapshot: string
          form_version_field_id: string
          id: string
          sort_order_snapshot: number
          stable_field_key: string
          submission_id: string
          value: Json
        }
        Insert: {
          created_at?: string
          field_label_snapshot: string
          field_type_snapshot: string
          form_version_field_id: string
          id?: string
          sort_order_snapshot: number
          stable_field_key: string
          submission_id: string
          value: Json
        }
        Update: {
          created_at?: string
          field_label_snapshot?: string
          field_type_snapshot?: string
          form_version_field_id?: string
          id?: string
          sort_order_snapshot?: number
          stable_field_key?: string
          submission_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "form_submission_values_form_version_field_id_fkey"
            columns: ["form_version_field_id"]
            isOneToOne: false
            referencedRelation: "form_version_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          client_profile_id: string | null
          company_id: string | null
          form_assignment_id: string | null
          form_id: string
          form_version_id: string
          id: string
          orchestration_status: string
          orchestration_type: string | null
          order_id: string | null
          provenance: Json
          revision_number: number
          root_submission_id: string
          status: string
          submitted_at: string
          submitted_by_profile_id: string | null
          supersedes_submission_id: string | null
        }
        Insert: {
          client_profile_id?: string | null
          company_id?: string | null
          form_assignment_id?: string | null
          form_id: string
          form_version_id: string
          id?: string
          orchestration_status?: string
          orchestration_type?: string | null
          order_id?: string | null
          provenance?: Json
          revision_number?: number
          root_submission_id: string
          status?: string
          submitted_at?: string
          submitted_by_profile_id?: string | null
          supersedes_submission_id?: string | null
        }
        Update: {
          client_profile_id?: string | null
          company_id?: string | null
          form_assignment_id?: string | null
          form_id?: string
          form_version_id?: string
          id?: string
          orchestration_status?: string
          orchestration_type?: string | null
          order_id?: string | null
          provenance?: Json
          revision_number?: number
          root_submission_id?: string
          status?: string
          submitted_at?: string
          submitted_by_profile_id?: string | null
          supersedes_submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_client_profile_id_fkey"
            columns: ["client_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_assignment_id_fkey"
            columns: ["form_assignment_id"]
            isOneToOne: false
            referencedRelation: "form_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_root_fkey"
            columns: ["root_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_submitted_by_profile_id_fkey"
            columns: ["submitted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_supersedes_submission_id_fkey"
            columns: ["supersedes_submission_id"]
            isOneToOne: true
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_version_form_fkey"
            columns: ["form_version_id", "form_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id", "form_id"]
          },
        ]
      }
      form_version_fields: {
        Row: {
          created_at: string
          default_value: Json | null
          field_type: string
          form_version_id: string
          help_html: string | null
          id: string
          internal_label: string | null
          label: string
          placeholder: string | null
          required: boolean
          settings: Json
          sort_order: number
          stable_field_key: string
        }
        Insert: {
          created_at?: string
          default_value?: Json | null
          field_type: string
          form_version_id: string
          help_html?: string | null
          id?: string
          internal_label?: string | null
          label: string
          placeholder?: string | null
          required?: boolean
          settings?: Json
          sort_order: number
          stable_field_key: string
        }
        Update: {
          created_at?: string
          default_value?: Json | null
          field_type?: string
          form_version_id?: string
          help_html?: string | null
          id?: string
          internal_label?: string | null
          label?: string
          placeholder?: string | null
          required?: boolean
          settings?: Json
          sort_order?: number
          stable_field_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_version_fields_form_version_id_fkey"
            columns: ["form_version_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_versions: {
        Row: {
          created_at: string
          created_by_profile_id: string
          form_id: string
          id: string
          information_html: string | null
          lifecycle_state: string
          published_at: string | null
          published_by_profile_id: string | null
          schema_hash: string | null
          title: string
          type_config: Json
          version_number: number
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          form_id: string
          id?: string
          information_html?: string | null
          lifecycle_state?: string
          published_at?: string | null
          published_by_profile_id?: string | null
          schema_hash?: string | null
          title: string
          type_config?: Json
          version_number: number
          visibility: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          form_id?: string
          id?: string
          information_html?: string | null
          lifecycle_state?: string
          published_at?: string | null
          published_by_profile_id?: string | null
          schema_hash?: string | null
          title?: string
          type_config?: Json
          version_number?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_versions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_versions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_versions_published_by_profile_id_fkey"
            columns: ["published_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          archived_at: string | null
          canonical_key: string
          created_at: string
          created_by_profile_id: string
          current_draft_version_id: string | null
          form_type: string
          id: string
          name: string
          published_version_id: string | null
          status: string
          updated_at: string
          updated_by_profile_id: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          canonical_key: string
          created_at?: string
          created_by_profile_id: string
          current_draft_version_id?: string | null
          form_type: string
          id?: string
          name: string
          published_version_id?: string | null
          status?: string
          updated_at?: string
          updated_by_profile_id: string
          visibility?: string
        }
        Update: {
          archived_at?: string | null
          canonical_key?: string
          created_at?: string
          created_by_profile_id?: string
          current_draft_version_id?: string | null
          form_type?: string
          id?: string
          name?: string
          published_version_id?: string | null
          status?: string
          updated_at?: string
          updated_by_profile_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "forms_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_current_draft_version_fkey"
            columns: ["current_draft_version_id", "id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id", "form_id"]
          },
          {
            foreignKeyName: "forms_published_version_fkey"
            columns: ["published_version_id", "id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id", "form_id"]
          },
          {
            foreignKeyName: "forms_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          connected_account_display: string | null
          connected_account_id: string | null
          connected_at: string | null
          connected_by_profile_id: string | null
          expires_at: string | null
          granted_scopes: string[]
          id: string
          last_synced_at: string | null
          provider: string
          provider_metadata: Json
          status: string
          updated_at: string
        }
        Insert: {
          connected_account_display?: string | null
          connected_account_id?: string | null
          connected_at?: string | null
          connected_by_profile_id?: string | null
          expires_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_synced_at?: string | null
          provider: string
          provider_metadata?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          connected_account_display?: string | null
          connected_account_id?: string | null
          connected_at?: string | null
          connected_by_profile_id?: string | null
          expires_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_synced_at?: string | null
          provider?: string
          provider_metadata?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connected_by_profile_id_fkey"
            columns: ["connected_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string | null
          fulfillment_status: string
          id: string
          invoice_id: string
          is_taxable: boolean
          line_subtotal_cents: number | null
          name: string
          order_id: string | null
          position: number
          quantity: number
          service_id: string | null
          unit_discount_cents: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          fulfillment_status: string
          id?: string
          invoice_id: string
          is_taxable?: boolean
          line_subtotal_cents?: number | null
          name: string
          order_id?: string | null
          position: number
          quantity: number
          service_id?: string | null
          unit_discount_cents?: number
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          fulfillment_status?: string
          id?: string
          invoice_id?: string
          is_taxable?: boolean
          line_subtotal_cents?: number | null
          name?: string
          order_id?: string | null
          position?: number
          quantity?: number
          service_id?: string | null
          unit_discount_cents?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_counters: {
        Row: {
          counter_key: string
          next_number: number
          updated_at: string
        }
        Insert: {
          counter_key: string
          next_number: number
          updated_at?: string
        }
        Update: {
          counter_key?: string
          next_number?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoice_payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by_profile_id: string
          currency: string
          id: string
          invoice_id: string
          payment_method: string
          processor: string | null
          processor_reference: string | null
          request_id: string
          settled_at: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by_profile_id: string
          currency: string
          id?: string
          invoice_id: string
          payment_method: string
          processor?: string | null
          processor_reference?: string | null
          request_id: string
          settled_at?: string | null
          status: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          id?: string
          invoice_id?: string
          payment_method?: string
          processor?: string | null
          processor_reference?: string | null
          request_id?: string
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by_profile_id: string
          currency: string
          id: string
          invoice_id: string
          invoice_payment_id: string | null
          processor: string | null
          processor_reference: string | null
          reason: string
          refunded_at: string | null
          request_id: string
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by_profile_id: string
          currency: string
          id?: string
          invoice_id: string
          invoice_payment_id?: string | null
          processor?: string | null
          processor_reference?: string | null
          reason: string
          refunded_at?: string | null
          request_id: string
          status: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          id?: string
          invoice_id?: string
          invoice_payment_id?: string | null
          processor?: string | null
          processor_reference?: string | null
          reason?: string
          refunded_at?: string | null
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refunds_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_invoice_payment_id_fkey"
            columns: ["invoice_payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        Insert: {
          archived_at?: string | null
          billing_reason?: string | null
          client_profile_id?: string | null
          company_id: string
          created_at?: string
          created_by_profile_id: string
          currency?: string
          discount_total_cents?: number
          due_at?: string | null
          id?: string
          invoice_number?: number | null
          issued_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_total_cents?: number
          total_cents?: number
          updated_at?: string
          updated_by_profile_id: string
          voided_at?: string | null
        }
        Update: {
          archived_at?: string | null
          billing_reason?: string | null
          client_profile_id?: string | null
          company_id?: string
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          discount_total_cents?: number
          due_at?: string | null
          id?: string
          invoice_number?: number | null
          issued_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_total_cents?: number
          total_cents?: number
          updated_at?: string
          updated_by_profile_id?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_profile_id_fkey"
            columns: ["client_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_profile_id: string | null
          audience: string
          body: string
          category: string
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_key: string
          href: string
          id: string
          message_count: number
          read_at: string | null
          recipient_profile_id: string
          title: string
          variant: string
        }
        Insert: {
          actor_profile_id?: string | null
          audience: string
          body: string
          category: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_key: string
          href: string
          id?: string
          message_count?: number
          read_at?: string | null
          recipient_profile_id: string
          title: string
          variant?: string
        }
        Update: {
          actor_profile_id?: string | null
          audience?: string
          body?: string
          category?: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_key?: string
          href?: string
          id?: string
          message_count?: number
          read_at?: string | null
          recipient_profile_id?: string
          title?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tasks: {
        Row: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          order_id: string
          sort_position?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          order_id?: string
          sort_position?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tasks_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          notes?: string | null
          order_number?: never
          priority?: string
          service_id: string
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          notes?: string | null
          order_number?: never
          priority?: string
          service_id?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          contact_id: string
          created_at: string
          organization_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          organization_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      permission_modules: {
        Row: {
          account_class: string
          created_at: string
          label: string
          module_key: string
          required_permission_key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_class: string
          created_at?: string
          label: string
          module_key: string
          required_permission_key: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_class?: string
          created_at?: string
          label?: string
          module_key?: string
          required_permission_key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_modules_required_permission_key_fkey"
            columns: ["required_permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission_key"]
          },
        ]
      }
      permission_presets: {
        Row: {
          account_class: string
          created_at: string
          id: string
          key: string
          name: string
          role_id: string
          sort_order: number
          system_managed: boolean
          updated_at: string
        }
        Insert: {
          account_class: string
          created_at?: string
          id?: string
          key: string
          name: string
          role_id: string
          sort_order?: number
          system_managed?: boolean
          updated_at?: string
        }
        Update: {
          account_class?: string
          created_at?: string
          id?: string
          key?: string
          name?: string
          role_id?: string
          sort_order?: number
          system_managed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_presets_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: true
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string
          label: string
          permission_key: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string
          label: string
          permission_key: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          label?: string
          permission_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      profile_permission_overrides: {
        Row: {
          allowed: boolean
          created_at: string
          permission_key: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          allowed: boolean
          created_at?: string
          permission_key: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          permission_key?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_permission_overrides_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission_key"]
          },
          {
            foreignKeyName: "profile_permission_overrides_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          notification_sound_enabled?: boolean
          role_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          notification_sound_enabled?: boolean
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_attachments: {
        Row: {
          checksum_sha256: string
          created_at: string
          id: string
          mime_type: string
          order_id: string
          original_name: string
          project_message_id: string
          scan_status: string
          size_bytes: number
          storage_object_key: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          checksum_sha256: string
          created_at?: string
          id?: string
          mime_type: string
          order_id: string
          original_name: string
          project_message_id: string
          scan_status?: string
          size_bytes: number
          storage_object_key: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          checksum_sha256?: string
          created_at?: string
          id?: string
          mime_type?: string
          order_id?: string
          original_name?: string
          project_message_id?: string
          scan_status?: string
          size_bytes?: number
          storage_object_key?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_attachments_message_order_fkey"
            columns: ["project_message_id", "order_id"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "project_attachments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_project_message_id_fkey"
            columns: ["project_message_id"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_message_reactions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message_id?: string
          reaction_code?: string
          reactor_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_message_reactions_reactor_profile_id_fkey"
            columns: ["reactor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_messages: {
        Row: {
          author_profile_id: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          order_id: string
          reply_quote_text: string | null
          reply_to_attachment_id: string | null
          reply_to_message_id: string | null
          request_id: string | null
        }
        Insert: {
          author_profile_id?: string | null
          author_type: string
          body: string
          created_at?: string
          id?: string
          order_id: string
          reply_quote_text?: string | null
          reply_to_attachment_id?: string | null
          reply_to_message_id?: string | null
          request_id?: string | null
        }
        Update: {
          author_profile_id?: string | null
          author_type?: string
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          reply_quote_text?: string | null
          reply_to_attachment_id?: string | null
          reply_to_message_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_messages_reply_attachment_fkey"
            columns: ["reply_to_attachment_id", "reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "project_attachments"
            referencedColumns: ["id", "project_message_id"]
          },
          {
            foreignKeyName: "project_messages_reply_source_fkey"
            columns: ["reply_to_message_id", "order_id"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["id", "order_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          permission_key: string
          role_id: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          permission_key: string
          role_id: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          permission_key?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission_key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      security_audit_events: {
        Row: {
          action_slug: string | null
          actor_class: string
          actor_profile_id: string | null
          correlation_id: string | null
          event_code: string
          id: string
          metadata: Json
          occurred_at: string
          outcome: string
          provider: string | null
          resource_id: string | null
          resource_type: string | null
          target_actor_id: string | null
        }
        Insert: {
          action_slug?: string | null
          actor_class: string
          actor_profile_id?: string | null
          correlation_id?: string | null
          event_code: string
          id?: string
          metadata?: Json
          occurred_at?: string
          outcome: string
          provider?: string | null
          resource_id?: string | null
          resource_type?: string | null
          target_actor_id?: string | null
        }
        Update: {
          action_slug?: string | null
          actor_class?: string
          actor_profile_id?: string | null
          correlation_id?: string | null
          event_code?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          outcome?: string
          provider?: string | null
          resource_id?: string | null
          resource_type?: string | null
          target_actor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_audit_events_target_actor_id_fkey"
            columns: ["target_actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_folders: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "service_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_interests: {
        Row: {
          add_count: number
          company_id: string
          contacted_at: string | null
          contacted_by_profile_id: string | null
          created_at: string
          first_added_at: string
          id: string
          in_cart: boolean
          last_activity_at: string
          last_added_at: string
          last_notified_at: string | null
          removed_at: string | null
          service_id: string
          signalled_by_profile_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          add_count?: number
          company_id: string
          contacted_at?: string | null
          contacted_by_profile_id?: string | null
          created_at?: string
          first_added_at?: string
          id?: string
          in_cart?: boolean
          last_activity_at?: string
          last_added_at?: string
          last_notified_at?: string | null
          removed_at?: string | null
          service_id: string
          signalled_by_profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          add_count?: number
          company_id?: string
          contacted_at?: string | null
          contacted_by_profile_id?: string | null
          created_at?: string
          first_added_at?: string
          id?: string
          in_cart?: boolean
          last_activity_at?: string
          last_added_at?: string
          last_notified_at?: string | null
          removed_at?: string | null
          service_id?: string
          signalled_by_profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_interests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_interests_contacted_by_profile_id_fkey"
            columns: ["contacted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_interests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_interests_signalled_by_profile_id_fkey"
            columns: ["signalled_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          created_at: string
          currency: string
          deadline_amount: number | null
          deadline_unit: string | null
          description: string | null
          folder_id: string | null
          group_quantities: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          recurring: boolean
          recurring_action: string | null
          recurring_interval_length: number | null
          recurring_interval_unit: string | null
          recurring_price: number | null
          require_client_profile: boolean
          sort_order: number
          subscription_eligible: boolean
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          created_at?: string
          currency?: string
          deadline_amount?: number | null
          deadline_unit?: string | null
          description?: string | null
          folder_id?: string | null
          group_quantities?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_public?: boolean
          name: string
          price?: number
          recurring?: boolean
          recurring_action?: string | null
          recurring_interval_length?: number | null
          recurring_interval_unit?: string | null
          recurring_price?: number | null
          require_client_profile?: boolean
          sort_order?: number
          subscription_eligible?: boolean
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          created_at?: string
          currency?: string
          deadline_amount?: number | null
          deadline_unit?: string | null
          description?: string | null
          folder_id?: string | null
          group_quantities?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_public?: boolean
          name?: string
          price?: number
          recurring?: boolean
          recurring_action?: string | null
          recurring_interval_length?: number | null
          recurring_interval_unit?: string | null
          recurring_price?: number | null
          require_client_profile?: boolean
          sort_order?: number
          subscription_eligible?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "service_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_cycles: {
        Row: {
          blocked_reason: string | null
          created_at: string
          due_on: string
          fulfillment_action: string
          fulfillment_metadata: Json
          fulfillment_status: string
          generated_at: string | null
          id: string
          idempotency_key: string
          invoice_id: string | null
          issue_on: string
          past_due_at: string | null
          period_end: string
          period_start: string
          plan_version_id: string
          sequence: number
          settled_at: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          created_at?: string
          due_on: string
          fulfillment_action: string
          fulfillment_metadata?: Json
          fulfillment_status?: string
          generated_at?: string | null
          id?: string
          idempotency_key: string
          invoice_id?: string | null
          issue_on: string
          past_due_at?: string | null
          period_end: string
          period_start: string
          plan_version_id: string
          sequence: number
          settled_at?: string | null
          status?: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          created_at?: string
          due_on?: string
          fulfillment_action?: string
          fulfillment_metadata?: Json
          fulfillment_status?: string
          generated_at?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string | null
          issue_on?: string
          past_due_at?: string | null
          period_end?: string
          period_start?: string
          plan_version_id?: string
          sequence?: number
          settled_at?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_cycles_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_cycles_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "subscription_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_cycles_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_dunning_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          cycle_id: string
          executed_at: string | null
          failure_code: string | null
          id: string
          outcome: string | null
          payment_method_ref: string | null
          provider: string | null
          scheduled_for: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          cycle_id: string
          executed_at?: string | null
          failure_code?: string | null
          id?: string
          outcome?: string | null
          payment_method_ref?: string | null
          provider?: string | null
          scheduled_for: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          cycle_id?: string
          executed_at?: string | null
          failure_code?: string | null
          id?: string
          outcome?: string | null
          payment_method_ref?: string | null
          provider?: string | null
          scheduled_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_dunning_attempts_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "subscription_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          actor_profile_id: string | null
          actor_type: string
          cycle_id: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          subscription_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_type: string
          cycle_id?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
          subscription_id: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_type?: string
          cycle_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "subscription_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payment_methods: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_fallback: boolean
          payment_method_ref: string
          priority: number
          processor_object_ref: string | null
          provider: string
          subscription_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          payment_method_ref: string
          priority?: number
          processor_object_ref?: string | null
          provider: string
          subscription_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          payment_method_ref?: string
          priority?: number
          processor_object_ref?: string | null
          provider?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payment_methods_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plan_items: {
        Row: {
          coupon_id: string | null
          coupon_recurring_duration: string | null
          created_at: string
          id: string
          is_taxable: boolean
          plan_version_id: string
          position: number
          quantity: number
          service_description_snapshot: string | null
          service_id: string | null
          service_name_snapshot: string
          unit_amount_cents: number
          unit_discount_cents: number
        }
        Insert: {
          coupon_id?: string | null
          coupon_recurring_duration?: string | null
          created_at?: string
          id?: string
          is_taxable?: boolean
          plan_version_id: string
          position: number
          quantity: number
          service_description_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot: string
          unit_amount_cents: number
          unit_discount_cents?: number
        }
        Update: {
          coupon_id?: string | null
          coupon_recurring_duration?: string | null
          created_at?: string
          id?: string
          is_taxable?: boolean
          plan_version_id?: string
          position?: number
          quantity?: number
          service_description_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string
          unit_amount_cents?: number
          unit_discount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plan_items_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plan_items_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "subscription_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plan_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plan_versions: {
        Row: {
          anchor_day: number | null
          created_at: string
          created_by_profile_id: string
          currency: string
          effective_from: string
          end_of_month_policy: string
          grace_days: number
          id: string
          interval_count: number
          interval_unit: string
          lead_days: number
          recurring_action: string
          request_limit_active: number | null
          request_limit_total: number | null
          subscription_id: string
          version: number
        }
        Insert: {
          anchor_day?: number | null
          created_at?: string
          created_by_profile_id: string
          currency: string
          effective_from: string
          end_of_month_policy?: string
          grace_days?: number
          id?: string
          interval_count?: number
          interval_unit: string
          lead_days?: number
          recurring_action: string
          request_limit_active?: number | null
          request_limit_total?: number | null
          subscription_id: string
          version: number
        }
        Update: {
          anchor_day?: number | null
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          effective_from?: string
          end_of_month_policy?: string
          grace_days?: number
          id?: string
          interval_count?: number
          interval_unit?: string
          lead_days?: number
          recurring_action?: string
          request_limit_active?: number | null
          request_limit_total?: number | null
          subscription_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plan_versions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plan_versions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        Insert: {
          archived_at?: string | null
          billing_anchor: string
          cancel_effective_at?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          client_profile_id?: string | null
          company_id: string
          created_at?: string
          created_by_profile_id: string
          current_period_end?: string | null
          current_plan_version_id?: string | null
          external_processor?: string | null
          external_processor_reference?: string | null
          id?: string
          paused_at?: string | null
          plan_source: string
          public_ref?: string
          resumes_at?: string | null
          service_id: string
          started_at?: string
          status?: string
          updated_at?: string
          updated_by_profile_id: string
        }
        Update: {
          archived_at?: string | null
          billing_anchor?: string
          cancel_effective_at?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          client_profile_id?: string | null
          company_id?: string
          created_at?: string
          created_by_profile_id?: string
          current_period_end?: string | null
          current_plan_version_id?: string | null
          external_processor?: string | null
          external_processor_reference?: string | null
          id?: string
          paused_at?: string | null
          plan_source?: string
          public_ref?: string
          resumes_at?: string | null
          service_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          updated_by_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_client_profile_id_fkey"
            columns: ["client_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_current_plan_version_fkey"
            columns: ["current_plan_version_id", "id"]
            isOneToOne: false
            referencedRelation: "subscription_plan_versions"
            referencedColumns: ["id", "subscription_id"]
          },
          {
            foreignKeyName: "subscriptions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_conversation_admins: {
        Row: {
          can_manage_admins: boolean
          can_manage_members: boolean
          can_manage_slow_mode: boolean
          can_manage_task_policy: boolean
          can_rename_conversation: boolean
          conversation_id: string
          granted_at: string
          granted_by_profile_id: string
          profile_id: string
        }
        Insert: {
          can_manage_admins?: boolean
          can_manage_members?: boolean
          can_manage_slow_mode?: boolean
          can_manage_task_policy?: boolean
          can_rename_conversation?: boolean
          conversation_id: string
          granted_at?: string
          granted_by_profile_id: string
          profile_id: string
        }
        Update: {
          can_manage_admins?: boolean
          can_manage_members?: boolean
          can_manage_slow_mode?: boolean
          can_manage_task_policy?: boolean
          can_rename_conversation?: boolean
          conversation_id?: string
          granted_at?: string
          granted_by_profile_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_conversation_admins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_conversation_admins_granted_by_profile_id_fkey"
            columns: ["granted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_conversation_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_conversation_members: {
        Row: {
          conversation_id: string
          created_at: string
          last_read_at: string | null
          profile_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          last_read_at?: string | null
          profile_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          last_read_at?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_conversation_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_conversations: {
        Row: {
          conversation_key: string
          created_at: string
          created_by_profile_id: string
          id: string
          kind: string
          last_message_at: string | null
          slow_mode_scope: string
          slow_mode_seconds: number | null
          task_creation_policy: string
          title: string | null
          updated_at: string
        }
        Insert: {
          conversation_key: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          kind?: string
          last_message_at?: string | null
          slow_mode_scope?: string
          slow_mode_seconds?: number | null
          task_creation_policy?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          conversation_key?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          kind?: string
          last_message_at?: string | null
          slow_mode_scope?: string
          slow_mode_seconds?: number | null
          task_creation_policy?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_conversations_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_message_deliveries: {
        Row: {
          conversation_id: string
          created_at: string
          eligible_at: string
          materialized_at: string | null
          message_id: string
          recipient_profile_id: string
          resolved_at: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          eligible_at: string
          materialized_at?: string | null
          message_id: string
          recipient_profile_id: string
          resolved_at?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          eligible_at?: string
          materialized_at?: string | null
          message_id?: string
          recipient_profile_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_message_deliveries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_deliveries_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_message_hidden_for_profiles: {
        Row: {
          hidden_at: string
          message_id: string
          profile_id: string
        }
        Insert: {
          hidden_at?: string
          message_id: string
          profile_id: string
        }
        Update: {
          hidden_at?: string
          message_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_message_hidden_for_profiles_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_hidden_for_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_message_pins: {
        Row: {
          conversation_id: string
          id: string
          message_id: string
          pinned_at: string
          pinned_by_profile_id: string
          unpinned_at: string | null
          unpinned_by_profile_id: string | null
        }
        Insert: {
          conversation_id: string
          id?: string
          message_id: string
          pinned_at?: string
          pinned_by_profile_id: string
          unpinned_at?: string | null
          unpinned_by_profile_id?: string | null
        }
        Update: {
          conversation_id?: string
          id?: string
          message_id?: string
          pinned_at?: string
          pinned_by_profile_id?: string
          unpinned_at?: string | null
          unpinned_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_message_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_pins_message_conversation_fk"
            columns: ["message_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id", "conversation_id"]
          },
          {
            foreignKeyName: "team_message_pins_pinned_by_profile_id_fkey"
            columns: ["pinned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_pins_unpinned_by_profile_id_fkey"
            columns: ["unpinned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_message_reactions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message_id?: string
          reaction_code?: string
          reactor_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_reactions_reactor_profile_id_fkey"
            columns: ["reactor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          author_profile_id: string
          body: string
          conversation_id: string
          created_at: string
          deleted_for_everyone_at: string | null
          deleted_for_everyone_by: string | null
          forwarded_from_author_name: string | null
          forwarded_from_message_id: string | null
          forwarded_from_ticket_message_id: string | null
          id: string
          message_type: string
          reply_quote_text: string | null
          reply_to_message_id: string | null
          request_id: string
          search_vector: unknown
          task_action: string | null
          task_id: string | null
          voice_duration_ms: number | null
          voice_expired_at: string | null
          voice_expires_at: string | null
          voice_mime_type: string | null
          voice_size_bytes: number | null
          voice_storage_path: string | null
        }
        Insert: {
          author_profile_id: string
          body: string
          conversation_id: string
          created_at?: string
          deleted_for_everyone_at?: string | null
          deleted_for_everyone_by?: string | null
          forwarded_from_author_name?: string | null
          forwarded_from_message_id?: string | null
          forwarded_from_ticket_message_id?: string | null
          id?: string
          message_type?: string
          reply_quote_text?: string | null
          reply_to_message_id?: string | null
          request_id: string
          search_vector?: unknown
          task_action?: string | null
          task_id?: string | null
          voice_duration_ms?: number | null
          voice_expired_at?: string | null
          voice_expires_at?: string | null
          voice_mime_type?: string | null
          voice_size_bytes?: number | null
          voice_storage_path?: string | null
        }
        Update: {
          author_profile_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_for_everyone_at?: string | null
          deleted_for_everyone_by?: string | null
          forwarded_from_author_name?: string | null
          forwarded_from_message_id?: string | null
          forwarded_from_ticket_message_id?: string | null
          id?: string
          message_type?: string
          reply_quote_text?: string | null
          reply_to_message_id?: string | null
          request_id?: string
          search_vector?: unknown
          task_action?: string | null
          task_id?: string | null
          voice_duration_ms?: number | null
          voice_expired_at?: string | null
          voice_expires_at?: string | null
          voice_mime_type?: string | null
          voice_size_bytes?: number | null
          voice_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_deleted_for_everyone_by_fkey"
            columns: ["deleted_for_everyone_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_forwarded_from_message_id_fkey"
            columns: ["forwarded_from_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_forwarded_from_ticket_message_id_fkey"
            columns: ["forwarded_from_ticket_message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "team_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      team_presence_connections: {
        Row: {
          connection_id: string
          last_seen_at: string
          profile_id: string
        }
        Insert: {
          connection_id: string
          last_seen_at?: string
          profile_id: string
        }
        Update: {
          connection_id?: string
          last_seen_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_presence_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_tasks: {
        Row: {
          assigned_to_profile_id: string
          completed_at: string | null
          completed_by_profile_id: string | null
          conversation_id: string
          created_at: string
          created_by_profile_id: string
          description: string | null
          due_at: string | null
          id: string
          priority: string
          request_id: string
          source_message_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to_profile_id: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          conversation_id: string
          created_at?: string
          created_by_profile_id: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          request_id: string
          source_message_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to_profile_id?: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by_profile_id?: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          request_id?: string
          source_message_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_tasks_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_tasks_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_tasks_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_tasks_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_typing_connections: {
        Row: {
          connection_id: string
          conversation_id: string
          last_typed_at: string
          profile_id: string
        }
        Insert: {
          connection_id: string
          conversation_id: string
          last_typed_at?: string
          profile_id: string
        }
        Update: {
          connection_id?: string
          conversation_id?: string
          last_typed_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_typing_connections_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_typing_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          checksum_sha256: string
          created_at: string
          id: string
          mime_type: string
          original_name: string
          scan_status: string
          size_bytes: number
          storage_object_key: string
          ticket_id: string
          ticket_message_id: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          checksum_sha256: string
          created_at?: string
          id?: string
          mime_type: string
          original_name: string
          scan_status?: string
          size_bytes: number
          storage_object_key: string
          ticket_id: string
          ticket_message_id: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          checksum_sha256?: string
          created_at?: string
          id?: string
          mime_type?: string
          original_name?: string
          scan_status?: string
          size_bytes?: number
          storage_object_key?: string
          ticket_id?: string
          ticket_message_id?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_message_ticket_fkey"
            columns: ["ticket_message_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id", "ticket_id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_message_id_fkey"
            columns: ["ticket_message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_message_reactions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          message_id: string
          reaction_code: string
          reactor_profile_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          message_id?: string
          reaction_code?: string
          reactor_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_message_reactions_reactor_profile_id_fkey"
            columns: ["reactor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_profile_id: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          message_kind: string
          reply_quote_text: string | null
          reply_to_attachment_id: string | null
          reply_to_message_id: string | null
          request_id: string | null
          ticket_id: string
          unsent_at: string | null
          unsent_by_profile_id: string | null
          visibility: string
        }
        Insert: {
          author_profile_id?: string | null
          author_type: string
          body: string
          created_at?: string
          id?: string
          message_kind: string
          reply_quote_text?: string | null
          reply_to_attachment_id?: string | null
          reply_to_message_id?: string | null
          request_id?: string | null
          ticket_id: string
          unsent_at?: string | null
          unsent_by_profile_id?: string | null
          visibility: string
        }
        Update: {
          author_profile_id?: string | null
          author_type?: string
          body?: string
          created_at?: string
          id?: string
          message_kind?: string
          reply_quote_text?: string | null
          reply_to_attachment_id?: string | null
          reply_to_message_id?: string | null
          request_id?: string | null
          ticket_id?: string
          unsent_at?: string | null
          unsent_by_profile_id?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_messages_reply_attachment_fkey"
            columns: ["reply_to_attachment_id", "reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "ticket_attachments"
            referencedColumns: ["id", "ticket_message_id"]
          },
          {
            foreignKeyName: "ticket_messages_reply_source_fkey"
            columns: ["reply_to_message_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id", "ticket_id"]
          },
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_messages_unsent_by_profile_id_fkey"
            columns: ["unsent_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          client_profile_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          inbox_added_at?: string | null
          investment_service_id?: string | null
          order_id?: string | null
          priority?: string
          public_ref?: string | null
          requester_email?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          source_form_submission_id?: string | null
          source_form_version_id?: string | null
          status?: string
          subject: string
          ticket_number?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to_profile_id?: string | null
          client_profile_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          inbox_added_at?: string | null
          investment_service_id?: string | null
          order_id?: string | null
          priority?: string
          public_ref?: string | null
          requester_email?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          source_form_submission_id?: string | null
          source_form_version_id?: string | null
          status?: string
          subject?: string
          ticket_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_client_profile_id_fkey"
            columns: ["client_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_investment_service_id_fkey"
            columns: ["investment_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_source_form_submission_id_fkey"
            columns: ["source_form_submission_id"]
            isOneToOne: true
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_source_form_version_id_fkey"
            columns: ["source_form_version_id"]
            isOneToOne: false
            referencedRelation: "form_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_card_memberships: {
        Row: {
          activated_at: string | null
          company_id: string
          created_at: string
          deactivated_at: string | null
          purchase_currency: string
          purchase_price_cents: number
          purchase_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          company_id: string
          created_at?: string
          deactivated_at?: string | null
          purchase_currency: string
          purchase_price_cents: number
          purchase_reference?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          company_id?: string
          created_at?: string
          deactivated_at?: string | null
          purchase_currency?: string
          purchase_price_cents?: number
          purchase_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_card_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_card_settings: {
        Row: {
          membership_currency: string
          membership_price_cents: number
          singleton: boolean
          updated_at: string
        }
        Insert: {
          membership_currency?: string
          membership_price_cents: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          membership_currency?: string
          membership_price_cents?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      permission_preset_grants: {
        Row: {
          account_class: string | null
          allowed: boolean | null
          permission_key: string | null
          preset_id: string | null
          preset_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission_key"]
          },
        ]
      }
    }
    Functions: {
      app_list_my_wallet_history: {
        Args: { p_limit?: number }
        Returns: {
          amount_cents: number
          balance_after_cents: number
          created_at: string
          currency: string
          id: string
          reason: string
          source: string
        }[]
      }
      app_find_invoice_item_by_order_id: {
        Args: { p_order_id: string }
        Returns: {
          created_at: string
          description: string | null
          fulfillment_status: string
          id: string
          invoice_id: string
          is_taxable: boolean
          line_subtotal_cents: number | null
          name: string
          order_id: string | null
          position: number
          quantity: number
          service_id: string | null
          unit_discount_cents: number
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_list_invoice_items: {
        Args: { p_invoice_id: string }
        Returns: {
          created_at: string
          description: string | null
          fulfillment_status: string
          id: string
          invoice_id: string
          is_taxable: boolean
          line_subtotal_cents: number | null
          name: string
          order_id: string | null
          position: number
          quantity: number
          service_id: string | null
          unit_discount_cents: number
          unit_price_cents: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "invoice_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      app_invoices_work_enabled: { Args: never; Returns: boolean }
      app_forms_work_enabled: { Args: never; Returns: boolean }
      app_get_form_assignment_history: { Args: { p_assignment_id: string }; Returns: Json }
      app_add_organization_member: {
        Args: { p_contact_id: string; p_organization_id: string }
        Returns: {
          contact_id: string
          created_at: string
          organization_id: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_add_team_conversation_member: {
        Args: { p_conversation_id: string; p_profile_id: string }
        Returns: Json
      }
      app_add_ticket_internal_note: {
        Args: { p_body: string; p_request_id: string; p_ticket_id: string }
        Returns: {
          author_profile_id: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          message_kind: string
          reply_quote_text: string | null
          reply_to_attachment_id: string | null
          reply_to_message_id: string | null
          request_id: string | null
          ticket_id: string
          unsent_at: string | null
          unsent_by_profile_id: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_add_ticket_to_inbox: {
        Args: { p_ticket_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_adjust_company_balance: {
        Args: {
          p_amount_cents: number
          p_company_id: string
          p_reason?: string
          p_request_id: string
        }
        Returns: {
          actor_profile_id: string
          amount_cents: number
          balance_after_cents: number
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          invoice_payment_id: string | null
          reason: string | null
          request_id: string
          source: string
        }
        SetofOptions: {
          from: "*"
          to: "company_wallet_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_company: {
        Args: { p_company_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_contact: {
        Args: { p_contact_id: string }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          job_title: string | null
          name: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_coupon: {
        Args: { p_coupon_id: string }
        Returns: {
          archived_at: string | null
          archived_by_profile_id: string | null
          code: string
          created_at: string
          created_by_profile_id: string | null
          description: string | null
          discount_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          minimum_cart_amount: number | null
          new_customers_only: boolean
          recurring_duration: string
          single_use_per_customer: boolean
          updated_at: string
          updated_by_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_form: {
        Args: { p_form_id: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          canonical_key: string
          created_at: string
          created_by_profile_id: string
          current_draft_version_id: string | null
          form_type: string
          id: string
          name: string
          published_version_id: string | null
          status: string
          updated_at: string
          updated_by_profile_id: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_order: {
        Args: { p_order_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_service: {
        Args: { p_service_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          created_at: string
          currency: string
          deadline_amount: number | null
          deadline_unit: string | null
          description: string | null
          folder_id: string | null
          group_quantities: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          recurring: boolean
          recurring_action: string | null
          recurring_interval_length: number | null
          recurring_interval_unit: string | null
          recurring_price: number | null
          require_client_profile: boolean
          sort_order: number
          subscription_eligible: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_service_folder: {
        Args: { p_folder_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_folders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_archive_ticket: {
        Args: { p_ticket_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_assign_client_profile_to_company: {
        Args: {
          p_company_id: string
          p_display_name?: string
          p_profile_id: string
        }
        Returns: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_assign_form: {
        Args: { p_context: Json; p_form_id: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          assigned_at: string
          assigned_by_profile_id: string
          canceled_at: string | null
          client_profile_id: string | null
          company_id: string
          completed_at: string | null
          due_at: string | null
          form_id: string
          form_version_id: string
          id: string
          latest_submission_id: string | null
          order_id: string | null
          required: boolean
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "form_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_assign_order: {
        Args: { p_assigned_to_profile_id?: string; p_order_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_assign_task: {
        Args: { p_assigned_to_profile_id?: string; p_task_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_assign_ticket: {
        Args: { p_assigned_to_profile_id?: string; p_ticket_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_cancel_subscription: {
        Args: { p_reason?: string; p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_change_order_status: {
        Args: { p_order_id: string; p_status: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_change_task_status: {
        Args: { p_status: string; p_task_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_claim_avatar_upload: { Args: never; Returns: undefined }
      app_clear_login_pair_failures: {
        Args: { p_identity_fingerprint: string; p_source_fingerprint: string }
        Returns: undefined
      }
      app_clear_my_avatar: {
        Args: never
        Returns: {
          previous_avatar_path: string
        }[]
      }
      app_clear_profile_permission_override: {
        Args: { p_permission_key: string; p_profile_id: string }
        Returns: boolean
      }
      app_clear_team_typing: {
        Args: { p_connection_id: string; p_conversation_id: string }
        Returns: undefined
      }
      app_complete_team_voice_cleanup: {
        Args: {
          p_expected_path: string
          p_object_kind: string
          p_record_id: string
        }
        Returns: undefined
      }
      app_consume_server_cost_limit: {
        Args: {
          p_action: string
          p_actor_id: string
          p_organization_id?: string
        }
        Returns: undefined
      }
      app_correct_form_submission: {
        Args: { p_request_id: string; p_submission_id: string; p_values: Json }
        Returns: {
          client_profile_id: string | null
          company_id: string | null
          form_assignment_id: string | null
          form_id: string
          form_version_id: string
          id: string
          orchestration_status: string
          orchestration_type: string | null
          order_id: string | null
          provenance: Json
          revision_number: number
          root_submission_id: string
          status: string
          submitted_at: string
          submitted_by_profile_id: string | null
          supersedes_submission_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "form_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_count_my_unread_reports: { Args: never; Returns: number }
      app_create_company: {
        Args: { p_name: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_contact: {
        Args: {
          p_company_id: string
          p_email?: string
          p_is_primary?: boolean
          p_job_title?: string
          p_name: string
          p_phone?: string
          p_profile_id?: string
          p_request_id: string
        }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          job_title: string | null
          name: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_coupon: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          archived_by_profile_id: string | null
          code: string
          created_at: string
          created_by_profile_id: string | null
          description: string | null
          discount_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          minimum_cart_amount: number | null
          new_customers_only: boolean
          recurring_duration: string
          single_use_per_customer: boolean
          updated_at: string
          updated_by_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_form: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          canonical_key: string
          created_at: string
          created_by_profile_id: string
          current_draft_version_id: string | null
          form_type: string
          id: string
          name: string
          published_version_id: string | null
          status: string
          updated_at: string
          updated_by_profile_id: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_invoice: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_order: {
        Args: {
          p_assigned_to_profile_id?: string
          p_company_id: string
          p_due_at?: string
          p_notes?: string
          p_priority?: string
          p_request_id: string
          p_service_id: string
          p_started_at?: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_organization: {
        Args: { p_name: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_report_draft: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          package_label: string
          report_lane: string
          reporting_period_month: string
          sent_at: string | null
          sent_by_profile_id: string
          service_id: string | null
          status: string
          subscription_id: string | null
          title: string
          updated_at: string
          wizard_step_key: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_service: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          created_at: string
          currency: string
          deadline_amount: number | null
          deadline_unit: string | null
          description: string | null
          folder_id: string | null
          group_quantities: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          recurring: boolean
          recurring_action: string | null
          recurring_interval_length: number | null
          recurring_interval_unit: string | null
          recurring_price: number | null
          require_client_profile: boolean
          sort_order: number
          subscription_eligible: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_service_folder: {
        Args: {
          p_description?: string
          p_name: string
          p_parent_id?: string
          p_request_id: string
          p_sort_order?: number
        }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_folders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_subscription: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_task: {
        Args: {
          p_assigned_to_profile_id?: string
          p_description?: string
          p_due_at?: string
          p_order_id: string
          p_request_id: string
          p_sort_position?: number
          p_title: string
        }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_create_team_group: {
        Args: { p_member_profile_ids: string[]; p_title: string }
        Returns: string
      }
      app_create_team_task: {
        Args: {
          p_assigned_to_profile_id: string
          p_conversation_id: string
          p_description?: string
          p_due_at?: string
          p_priority?: string
          p_request_id: string
          p_source_message_id?: string
          p_title: string
        }
        Returns: Json
      }
      app_create_ticket: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_current_tenant_membership: {
        Args: never
        Returns: {
          account_class: string
          role_name: string
          tenant_id: string
        }[]
      }
      app_current_user_modules: {
        Args: never
        Returns: {
          account_class: string
          granted: boolean
          label: string
          module_key: string
          required_permission_key: string
        }[]
      }
      app_current_user_permissions: {
        Args: never
        Returns: {
          permission_key: string
        }[]
      }
      app_dashboard_overview: {
        Args: {
          p_bucket: string
          p_end: string
          p_previous_end: string
          p_previous_start: string
          p_start: string
          p_time_zone: string
        }
        Returns: Json
      }
      app_delete_team_message_for_everyone: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      app_discard_report_draft: {
        Args: { p_report_id: string }
        Returns: boolean
      }
      app_disconnect_team_presence: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      app_duplicate_service: {
        Args: { p_request_id: string; p_service_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          created_at: string
          currency: string
          deadline_amount: number | null
          deadline_unit: string | null
          description: string | null
          folder_id: string | null
          group_quantities: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          recurring: boolean
          recurring_action: string | null
          recurring_interval_length: number | null
          recurring_interval_unit: string | null
          recurring_price: number | null
          require_client_profile: boolean
          sort_order: number
          subscription_eligible: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_finalize_team_voice_upload: {
        Args: {
          p_duration_ms: number
          p_mime_type: string
          p_retention_days: number
          p_size_bytes: number
          p_upload_id: string
        }
        Returns: Json
      }
      app_forward_team_message: {
        Args: {
          p_destination_conversation_id: string
          p_request_id: string
          p_source_message_id: string
        }
        Returns: Json
      }
      app_forward_ticket_message_to_team: {
        Args: {
          p_comment?: string
          p_destination_conversation_id: string
          p_request_id: string
          p_source_ticket_message_id: string
        }
        Returns: Json
      }
      app_generate_subscription_cycle_invoice: {
        Args: { p_cycle_id: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_get_assigned_form_schema: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      app_get_client_account_context: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          display_name: string
          profile_id: string
        }[]
      }
      app_get_company_wallet: {
        Args: { p_company_id: string }
        Returns: {
          balance_cents: number
          company_id: string
          created_at: string
          currency: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_get_form_submission: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      app_get_internal_report: { Args: { p_report_id: string }; Returns: Json }
      app_get_invoice_financials: {
        Args: { p_invoice_id: string }
        Returns: {
          balance_due_cents: number
          gross_paid_cents: number
          invoice_id: string
          is_overdue: boolean
          net_paid_cents: number
          persisted_status: string
          presentation_state: string
          successful_refunds_cents: number
        }[]
      }
      app_get_my_client_project: {
        Args: { p_project_id: string }
        Returns: {
          completed_at: string
          created_at: string
          due_at: string
          id: string
          order_number: number
          service_name: string
          started_at: string
          status: string
          task_open: number
          task_total: number
          title: string
        }[]
      }
      app_get_my_client_report: { Args: { p_report_id: string }; Returns: Json }
      app_get_my_profile: {
        Args: never
        Returns: {
          avatar_path: string
          avatar_url: string
          created_at: string
          display_name: string
          email: string
          notification_sound_enabled: boolean
          preset_key: string
          preset_name: string
          profile_id: string
          role_name: string
        }[]
      }
      app_get_order_conversation: {
        Args: { p_order_id: string }
        Returns: Json
      }
      app_get_profile_effective_permissions: {
        Args: { p_profile_id?: string }
        Returns: {
          allowed: boolean
          category: string
          permission_key: string
          source: string
        }[]
      }
      app_get_profile_permission_summary: {
        Args: { p_profile_id?: string }
        Returns: {
          account_class: string
          company_id: string
          display_name: string
          override_count: number
          preset_key: string
          preset_name: string
          profile_id: string
        }[]
      }
      app_get_project_conversation: {
        Args: { p_order_id: string }
        Returns: Json
      }
      app_get_published_form_schema: {
        Args: { p_canonical_key: string }
        Returns: Json
      }
      app_get_report_send_status: {
        Args: { p_report_id: string }
        Returns: {
          can_send: boolean
          reporting_period_month: string
          send_anytime: boolean
          window_end: string
          window_start: string
        }[]
      }
      app_get_subscription_detail: {
        Args: { p_subscription_id: string }
        Returns: Json
      }
      app_get_team_conversation: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      app_get_team_message_window: {
        Args: {
          p_after?: number
          p_before?: number
          p_conversation_id: string
          p_message_id: string
        }
        Returns: Json
      }
      app_get_team_supervised_conversation: {
        Args: {
          p_conversation_id: string
          p_correlation_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      app_get_team_supervised_message_window: {
        Args: {
          p_after_limit?: number
          p_before_limit?: number
          p_conversation_id: string
          p_correlation_id?: string
          p_target_message_id: string
        }
        Returns: Json
      }
      app_get_team_voice_playback: {
        Args: { p_message_id: string }
        Returns: Json
      }
      app_get_team_voice_upload_context: {
        Args: { p_upload_id: string }
        Returns: Json
      }
      app_get_ticket_attachment_download: {
        Args: { p_attachment_id: string }
        Returns: Json
      }
      app_get_ticket_detail: { Args: { p_ticket_id: string }; Returns: Json }
      app_get_ticket_detail_with_avatars: {
        Args: { p_ticket_id: string }
        Returns: Json
      }
      app_get_wf_card_settings: {
        Args: never
        Returns: {
          membership_currency: string
          membership_price_cents: number
        }[]
      }
      app_get_white_label_draft: {
        Args: { p_tenant_id: string }
        Returns: {
          accent_color: string
          display_name: string
          module_keys: string[]
          primary_color: string
          revision: number
          tenant_id: string
          tenant_status: string
          updated_at: string | null
        }[]
      }
      app_grant_report_send_anytime: {
        Args: { p_profile_id: string }
        Returns: {
          allowed: boolean
          created_at: string
          permission_key: string
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_permission_overrides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_grant_team_conversation_admin: {
        Args: {
          p_capabilities: Json
          p_conversation_id: string
          p_target_profile_id: string
        }
        Returns: Json
      }
      app_has_permission: {
        Args: { p_permission_key: string }
        Returns: boolean
      }
      app_hide_team_message_for_me: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      app_is_platform_admin: {
        Args: never
        Returns: boolean
      }
      app_issue_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_link_company_stripe_customer: {
        Args: { p_company_id: string; p_stripe_customer_id: string }
        Returns: string
      }
      app_list_form_submissions: {
        Args: { p_form_id?: string; p_order_id?: string }
        Returns: Database["public"]["Tables"]["form_submissions"]["Row"][]
      }
      app_list_assigned_forms: {
        Args: never
        Returns: {
          assigned_at: string
          assignment_id: string
          client_name: string
          client_profile_id: string
          company_id: string
          company_name: string
          completed_at: string
          due_at: string
          form_id: string
          form_type: string
          form_version_id: string
          latest_submission_id: string
          order_id: string
          order_number: number
          order_title: string
          required: boolean
          status: string
          title: string
          version_number: number
        }[]
      }
      app_list_client_company_directory: {
        Args: never
        Returns: {
          archived_at: string
          created_at: string
          id: string
          name: string
          status: string
          updated_at: string
        }[]
      }
      app_list_due_subscription_work: {
        Args: { p_limit?: number }
        Returns: {
          cycle_id: string
          due_at: string
          reason: string
          subscription_id: string
          work_type: string
        }[]
      }
      app_list_integration_connections: {
        Args: never
        Returns: {
          connected_account_display: string
          connected_account_id: string
          connected_at: string
          connected_by_profile_id: string
          expires_at: string
          granted_scopes: string[]
          id: string
          last_synced_at: string
          provider: string
          status: string
          updated_at: string
        }[]
      }
      app_list_internal_members: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          email: string
          is_self: boolean
          override_count: number
          preset_key: string
          preset_name: string
          profile_id: string
          report_send_anytime: boolean
          sort_order: number
        }[]
      }
      app_list_internal_reports: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          company_id: string
          company_name: string
          entry_count: number
          package_label: string
          report_id: string
          report_lane: string
          section_count: number
          sent_at: string
          sent_by_name: string
          status: string
          title: string
          updated_at: string
        }[]
      }
      app_list_investment_intents: {
        Args: { p_limit?: number }
        Returns: {
          active_ticket_id: string
          active_ticket_status: string
          add_count: number
          company_id: string
          company_name: string
          contacted_at: string
          contacted_by_name: string
          contacted_by_profile_id: string
          currency: string
          first_added_at: string
          folder_name: string
          in_cart: boolean
          intent_id: string
          last_activity_at: string
          last_added_at: string
          price: number
          recurring: boolean
          recurring_interval_length: number
          recurring_interval_unit: string
          recurring_price: number
          removed_at: string
          service_id: string
          service_name: string
          status: string
          updated_at: string
        }[]
      }
      app_list_my_client_projects: {
        Args: { p_limit?: number }
        Returns: {
          completed_at: string
          created_at: string
          due_at: string
          id: string
          order_number: number
          service_name: string
          started_at: string
          status: string
          task_open: number
          task_total: number
          title: string
        }[]
      }
      app_list_my_client_reports: {
        Args: { p_limit?: number }
        Returns: {
          is_read: boolean
          package_label: string
          report_id: string
          report_lane: string
          report_url: string
          sent_at: string
          title: string
        }[]
      }
      app_list_my_notifications: {
        Args: { p_limit?: number }
        Returns: {
          actor_profile_id: string
          audience: string
          body: string
          category: string
          company_id: string
          created_at: string
          entity_id: string
          entity_type: string
          event_key: string
          href: string
          id: string
          read_at: string
          title: string
          variant: string
        }[]
      }
      app_list_my_team_tasks: {
        Args: { p_include_team?: boolean }
        Returns: {
          assigned_to_name: string
          assigned_to_profile_id: string
          completed_at: string
          completed_by_profile_id: string
          conversation_id: string
          conversation_kind: string
          conversation_name: string
          created_at: string
          created_by_name: string
          created_by_profile_id: string
          description: string
          due_at: string
          id: string
          is_mine: boolean
          other_member_name: string
          priority: string
          source_message_id: string
          status: string
          title: string
          updated_at: string
        }[]
      }
      app_list_onboarding_assignment_candidates: {
        Args: { p_company_id?: string }
        Returns: {
          company_id: string
          company_name: string
          display_name: string
          profile_id: string
        }[]
      }
      app_list_operational_assignees: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          profile_id: string
        }[]
      }
      app_list_permission_preset_grants: {
        Args: never
        Returns: {
          allowed: boolean
          category: string
          description: string
          label: string
          permission_key: string
          preset_key: string
        }[]
      }
      app_list_permission_preset_overview: {
        Args: never
        Returns: {
          account_class: string
          granted_permission_count: number
          member_count: number
          preset_key: string
          preset_name: string
          sort_order: number
          total_permission_count: number
        }[]
      }
      app_list_permission_presets: {
        Args: never
        Returns: {
          account_class: string
          preset_id: string
          preset_key: string
          preset_name: string
          sort_order: number
          system_managed: boolean
        }[]
      }
      app_list_recent_company_wallet_transactions: {
        Args: { p_limit?: number }
        Returns: {
          actor_display_name: string
          actor_profile_id: string
          amount_cents: number
          balance_after_cents: number
          client_name: string
          company_id: string
          company_name: string
          created_at: string
          currency: string
          is_current_actor: boolean
          reason: string
          source: string
          transaction_id: string
        }[]
      }
      app_list_reported_one_time_deliverables: {
        Args: {
          p_company_id: string
          p_service_id: string
          p_subscription_id?: string
        }
        Returns: string[]
      }
      app_list_reporting_service_options: {
        Args: { p_company_id: string; p_supported_service_ids: string[] }
        Returns: {
          service_id: string
          service_name: string
          subscription_id: string
          subscription_status: string
        }[]
      }
      app_list_subscription_summaries: {
        Args: never
        Returns: {
          amount_cents: number
          client_profile_id: string
          company_id: string
          company_name: string
          currency: string
          health: string
          interval_count: number
          interval_unit: string
          last_payment_at: string
          next_payment_on: string
          paid_cycle_count: number
          public_ref: string
          service_id: string
          service_name: string
          status: string
          subscription_id: string
        }[]
      }
      app_list_team_conversations: {
        Args: never
        Returns: {
          conversation_id: string
          conversation_kind: string
          conversation_title: string
          destination_search_text: string
          last_message_at: string
          last_message_author_avatar_url: string
          last_message_author_name: string
          last_message_author_profile_id: string
          last_message_id: string
          last_message_preview: string
          last_message_type: string
          member_count: number
          my_last_read_at: string
          other_member_avatar_url: string
          other_member_name: string
          other_member_profile_id: string
          unread_count: number
        }[]
      }
      app_list_team_members: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          email: string
          profile_id: string
        }[]
      }
      app_list_team_messages_before: {
        Args: {
          p_before_created_at: string
          p_before_id: string
          p_conversation_id: string
          p_limit?: number
        }
        Returns: Json
      }
      app_list_team_supervised_conversations: {
        Args: {
          p_before_conversation_id?: string
          p_before_last_message_at?: string
          p_limit?: number
        }
        Returns: {
          conversation_id: string
          conversation_kind: string
          created_at: string
          last_message_at: string
          participant_one_archived: boolean
          participant_one_avatar_url: string
          participant_one_name: string
          participant_one_profile_id: string
          participant_two_archived: boolean
          participant_two_avatar_url: string
          participant_two_name: string
          participant_two_profile_id: string
        }[]
      }
      app_list_team_supervised_messages_before: {
        Args: {
          p_before_created_at: string
          p_before_message_id: string
          p_conversation_id: string
          p_correlation_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      app_list_team_typing: {
        Args: { p_conversation_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          last_typed_at: string
          profile_id: string
        }[]
      }
      app_list_team_voice_cleanup_batch: {
        Args: { p_limit?: number }
        Returns: {
          object_kind: string
          record_id: string
          storage_path: string
        }[]
      }
      app_list_ticket_summaries: {
        Args: { p_inbox_only?: boolean; p_include_archived?: boolean }
        Returns: {
          archived_at: string
          assigned_to_name: string
          assigned_to_profile_id: string
          client_name: string
          client_profile_id: string
          company_id: string
          company_name: string
          created_at: string
          inbox_added_at: string
          last_message_at: string
          message_count: number
          priority: string
          public_ref: string
          status: string
          subject: string
          ticket_id: string
          updated_at: string
        }[]
      }
      app_list_white_label_tenants: {
        Args: never
        Returns: {
          display_name: string
          draft_revision: number | null
          slug: string
          status: string
          tenant_id: string
        }[]
      }
      app_login_rate_limit_preflight: {
        Args: { p_identity_fingerprint: string; p_source_fingerprint: string }
        Returns: Json
      }
      app_mark_all_notifications_read: { Args: never; Returns: number }
      app_mark_client_report_read: {
        Args: { p_report_id: string }
        Returns: boolean
      }
      app_mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      app_mark_team_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      app_materialize_team_message_digests: { Args: never; Returns: number }
      app_pause_subscription: {
        Args: { p_resumes_at?: string; p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_pay_invoice_with_wallet: {
        Args: {
          p_coupon_code?: string
          p_invoice_id: string
          p_request_id: string
        }
        Returns: {
          invoice_balance_cents: number
          payment_id: string
          wallet_balance_cents: number
          wallet_transaction_id: string
        }[]
      }
      app_pin_team_message: { Args: { p_message_id: string }; Returns: Json }
      app_prepare_team_voice_upload: {
        Args: { p_conversation_id: string; p_mime_type: string }
        Returns: Json
      }
      app_prepare_ticket_attachment: {
        Args: {
          p_order_id?: string
          p_reply_to_message_id?: string
          p_request_id: string
          p_ticket_id?: string
        }
        Returns: Json
      }
      app_provision_client_account_profile: {
        Args: {
          p_company_id: string
          p_display_name?: string
          p_overrides?: Json
          p_profile_id: string
        }
        Returns: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_provision_internal_member_profile: {
        Args: {
          p_display_name?: string
          p_overrides?: Json
          p_preset_key: string
          p_profile_id: string
        }
        Returns: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_publish_form: {
        Args: { p_form_id: string; p_request_id: string }
        Returns: {
          created_at: string
          created_by_profile_id: string
          form_id: string
          id: string
          information_html: string | null
          lifecycle_state: string
          published_at: string | null
          published_by_profile_id: string | null
          schema_hash: string | null
          title: string
          type_config: Json
          version_number: number
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "form_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_purchase_service_with_balance: {
        Args: {
          p_coupon_code?: string
          p_request_id: string
          p_service_id: string
        }
        Returns: {
          amount_cents: number
          currency: string
          invoice_id: string
          invoice_number: number
          order_id: string
          order_number: number
          payment_id: string
          replayed: boolean
          service_name: string
          ticket_id: string
          ticket_public_ref: string
          wallet_balance_cents: number
        }[]
      }
      app_quote_invoice_coupon: {
        Args: { p_coupon_code: string; p_invoice_id: string }
        Returns: Json
      }
      app_quote_store_coupon: {
        Args: { p_coupon_code: string; p_service_id: string }
        Returns: Json
      }
      app_reconcile_subscription_state: {
        Args: { p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_record_invoice_payment: {
        Args: {
          p_amount_cents: number
          p_invoice_id: string
          p_payment_method?: string
          p_processor?: string
          p_processor_reference?: string
          p_request_id: string
          p_status?: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          created_by_profile_id: string
          currency: string
          id: string
          invoice_id: string
          payment_method: string
          processor: string | null
          processor_reference: string | null
          request_id: string
          settled_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_record_login_failure: {
        Args: { p_identity_fingerprint: string; p_source_fingerprint: string }
        Returns: undefined
      }
      app_record_store_interest: {
        Args: { p_in_cart: boolean; p_service_ids: string[] }
        Returns: number
      }
      app_refund_invoice: {
        Args: {
          p_amount_cents: number
          p_invoice_id: string
          p_invoice_payment_id?: string
          p_processor?: string
          p_processor_reference?: string
          p_reason: string
          p_request_id: string
          p_status?: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          created_by_profile_id: string
          currency: string
          id: string
          invoice_id: string
          invoice_payment_id: string | null
          processor: string | null
          processor_reference: string | null
          reason: string
          refunded_at: string | null
          request_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_remove_subscription_cancellation: {
        Args: { p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_remove_team_conversation_member: {
        Args: { p_conversation_id: string; p_profile_id: string }
        Returns: Json
      }
      app_rename_team_conversation: {
        Args: { p_conversation_id: string; p_title: string }
        Returns: Json
      }
      app_reorder_task: {
        Args: { p_sort_position: number; p_task_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reply_to_order_message: {
        Args: {
          p_body: string
          p_order_id: string
          p_reply_to_attachment_id?: string
          p_reply_to_message_id: string
          p_request_id: string
        }
        Returns: string
      }
      app_reply_to_ticket: {
        Args: { p_body: string; p_request_id: string; p_ticket_id: string }
        Returns: {
          author_profile_id: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          message_kind: string
          reply_quote_text: string | null
          reply_to_attachment_id: string | null
          reply_to_message_id: string | null
          request_id: string | null
          ticket_id: string
          unsent_at: string | null
          unsent_by_profile_id: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_reply_to_ticket_message: {
        Args: {
          p_body: string
          p_reply_to_attachment_id?: string
          p_reply_to_message_id: string
          p_request_id: string
          p_ticket_id: string
        }
        Returns: {
          author_profile_id: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          message_kind: string
          reply_quote_text: string | null
          reply_to_attachment_id: string | null
          reply_to_message_id: string | null
          request_id: string | null
          ticket_id: string
          unsent_at: string | null
          unsent_by_profile_id: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_require_module_access: {
        Args: { p_module_key: string }
        Returns: boolean
      }
      app_resolve_tenant_host: {
        Args: { p_host: string }
        Returns: string | null
      }
      app_restore_subscription_cycle: {
        Args: { p_cycle_id: string }
        Returns: {
          blocked_reason: string | null
          created_at: string
          due_on: string
          fulfillment_action: string
          fulfillment_metadata: Json
          fulfillment_status: string
          generated_at: string | null
          id: string
          idempotency_key: string
          invoice_id: string | null
          issue_on: string
          past_due_at: string | null
          period_end: string
          period_start: string
          plan_version_id: string
          sequence: number
          settled_at: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_cycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_resume_subscription: {
        Args: { p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_revoke_report_send_anytime: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      app_revoke_team_conversation_admin: {
        Args: { p_conversation_id: string; p_target_profile_id: string }
        Returns: Json
      }
      app_save_report_draft: {
        Args: { p_payload: Json; p_report_id: string }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          package_label: string
          report_lane: string
          reporting_period_month: string
          sent_at: string | null
          sent_by_profile_id: string
          service_id: string | null
          status: string
          subscription_id: string | null
          title: string
          updated_at: string
          wizard_step_key: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_save_white_label_draft: {
        Args: {
          p_accent_color: string
          p_display_name: string
          p_expected_revision: number
          p_module_keys: string[]
          p_primary_color: string
          p_tenant_id: string
        }
        Returns: {
          already_applied: boolean
          revision: number
          updated_at: string
        }[]
      }
      app_schedule_subscription_cancellation: {
        Args: { p_reason?: string; p_subscription_id: string }
        Returns: {
          archived_at: string | null
          billing_anchor: string
          cancel_effective_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          current_period_end: string | null
          current_plan_version_id: string | null
          external_processor: string | null
          external_processor_reference: string | null
          id: string
          paused_at: string | null
          plan_source: string
          public_ref: string
          resumes_at: string | null
          service_id: string
          started_at: string
          status: string
          updated_at: string
          updated_by_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_search_client_directory: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          client_contact_id: string
          client_profile_id: string
          company_id: string
          company_name: string
          display_name: string
        }[]
      }
      app_search_team_conversation_messages: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_conversation_id: string
          p_limit?: number
          p_query: string
        }
        Returns: Json
      }
      app_search_team_supervised_conversation_messages: {
        Args: {
          p_before_created_at?: string
          p_before_message_id?: string
          p_conversation_id: string
          p_correlation_id?: string
          p_limit?: number
          p_query: string
        }
        Returns: Json
      }
      app_send_client_report: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          package_label: string
          report_lane: string
          reporting_period_month: string
          sent_at: string | null
          sent_by_profile_id: string
          service_id: string | null
          status: string
          subscription_id: string | null
          title: string
          updated_at: string
          wizard_step_key: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_send_order_message: {
        Args: {
          p_body: string
          p_internal_note?: boolean
          p_order_id: string
          p_request_id: string
        }
        Returns: string
      }
      app_send_report_draft: {
        Args: { p_report_id: string; p_request_id: string }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          package_label: string
          report_lane: string
          reporting_period_month: string
          sent_at: string | null
          sent_by_profile_id: string
          service_id: string | null
          status: string
          subscription_id: string | null
          title: string
          updated_at: string
          wizard_step_key: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_send_team_message: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_request_id: string
        }
        Returns: Json
      }
      app_send_team_reply: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_reply_quote_text: string
          p_reply_to_message_id: string
          p_request_id: string
        }
        Returns: Json
      }
      app_send_ticket_message_with_attachment: {
        Args: {
          p_body?: string
          p_checksum_sha256?: string
          p_mime_type?: string
          p_order_id?: string
          p_original_name?: string
          p_reply_to_message_id?: string
          p_request_id: string
          p_size_bytes?: number
          p_ticket_id?: string
        }
        Returns: Json
      }
      app_server_claim_client_welcome_email: {
        Args: {
          p_actor_id: string
          p_profile_id: string
          p_tenant_id: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: {
          canonical_host: string
          outcome: string
          recipient_email: string
          recipient_name: string
        }[]
      }
      app_server_complete_client_activation: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: undefined
      }
      app_server_disconnect_gmail: {
        Args: { p_actor_id: string }
        Returns: undefined
      }
      app_server_find_client_activation: {
        Args: { p_token_hash: string; p_tenant_id: string }
        Returns: string
      }
      app_server_finish_client_welcome_email: {
        Args: {
          p_actor_id: string
          p_failure_code?: string
          p_profile_id: string
          p_tenant_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      app_server_read_gmail_credentials: {
        Args: { p_actor_id: string }
        Returns: {
          credential_reference: string
          credentials: Json
        }[]
      }
      app_server_read_gmail_credentials_for_administration: {
        Args: { p_actor_id: string }
        Returns: {
          credential_reference: string
          credentials: Json
        }[]
      }
      app_server_set_gmail_status: {
        Args: { p_actor_id: string; p_status: string }
        Returns: undefined
      }
      app_server_store_gmail_connection: {
        Args: {
          p_account_display: string
          p_account_id: string
          p_actor_id: string
          p_credentials: Json
          p_expires_at: string
          p_granted_scopes: string[]
        }
        Returns: string
      }
      app_server_update_gmail_credentials: {
        Args: { p_actor_id: string; p_credentials: Json; p_expires_at: string }
        Returns: undefined
      }
      app_server_verify_gmail_connection: {
        Args: { p_actor_id: string; p_expires_at: string }
        Returns: undefined
      }
      app_set_client_conversation_presence: {
        Args: {
          p_active: boolean
          p_conversation_id: string
          p_conversation_type: string
        }
        Returns: undefined
      }
      app_set_investment_intent_status: {
        Args: { p_intent_id: string; p_status: string }
        Returns: {
          add_count: number
          company_id: string
          contacted_at: string | null
          contacted_by_profile_id: string | null
          created_at: string
          first_added_at: string
          id: string
          in_cart: boolean
          last_activity_at: string
          last_added_at: string
          last_notified_at: string | null
          removed_at: string | null
          service_id: string
          signalled_by_profile_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_interests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_set_my_avatar: {
        Args: { p_avatar_path: string; p_avatar_url: string }
        Returns: {
          previous_avatar_path: string
        }[]
      }
      app_set_profile_permission_override: {
        Args: {
          p_allowed: boolean
          p_permission_key: string
          p_profile_id: string
        }
        Returns: {
          allowed: boolean
          created_at: string
          permission_key: string
          profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_permission_overrides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_set_profile_permission_preset: {
        Args: { p_preset_key: string; p_profile_id: string }
        Returns: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_set_service_folder_subscription_eligibility: {
        Args: { p_eligible: boolean; p_folder_id: string }
        Returns: number
      }
      app_set_team_conversation_slow_mode: {
        Args: { p_conversation_id: string; p_scope?: string; p_seconds: number }
        Returns: Json
      }
      app_set_team_task_creation_policy: {
        Args: { p_conversation_id: string; p_policy: string }
        Returns: Json
      }
      app_set_wf_card_membership: {
        Args: { p_active: boolean; p_company_id: string; p_request_id: string }
        Returns: {
          activated_at: string | null
          company_id: string
          created_at: string
          deactivated_at: string | null
          purchase_currency: string
          purchase_price_cents: number
          purchase_reference: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "wf_card_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_start_team_conversation: {
        Args: { p_other_profile_id: string }
        Returns: string
      }
      app_store_purchase_projects_enabled: { Args: never; Returns: boolean }
      app_subscriptions_work_enabled: { Args: never; Returns: boolean }
      app_submit_form: {
        Args: {
          p_context: Json
          p_files?: Json
          p_form_version_id: string
          p_request_id: string
          p_values: Json
        }
        Returns: {
          client_profile_id: string | null
          company_id: string | null
          form_assignment_id: string | null
          form_id: string
          form_version_id: string
          id: string
          orchestration_status: string
          orchestration_type: string | null
          order_id: string | null
          provenance: Json
          revision_number: number
          root_submission_id: string
          status: string
          submitted_at: string
          submitted_by_profile_id: string | null
          supersedes_submission_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "form_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_team_live_sync: {
        Args: { p_conversation_id?: string; p_since?: string }
        Returns: Json
      }
      app_team_unread_count: { Args: never; Returns: number }
      app_toggle_order_message_reaction: {
        Args: {
          p_message_id: string
          p_order_id: string
          p_reaction_code: string
        }
        Returns: Json
      }
      app_toggle_team_message_reaction: {
        Args: { p_message_id: string; p_reaction_code: string }
        Returns: Json
      }
      app_toggle_ticket_message_reaction: {
        Args: { p_message_id: string; p_reaction_code: string }
        Returns: Json
      }
      app_touch_team_presence: {
        Args: { p_connection_id: string }
        Returns: string[]
      }
      app_touch_team_typing: {
        Args: { p_connection_id: string; p_conversation_id: string }
        Returns: undefined
      }
      app_unpin_team_message: { Args: { p_pin_id: string }; Returns: Json }
      app_unsend_ticket_internal_note: {
        Args: { p_message_id: string }
        Returns: Json
      }
      app_update_company: {
        Args: { p_company_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_contact: {
        Args: { p_contact_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          job_title: string | null
          name: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_coupon: {
        Args: { p_coupon_id: string; p_payload: Json }
        Returns: {
          archived_at: string | null
          archived_by_profile_id: string | null
          code: string
          created_at: string
          created_by_profile_id: string | null
          description: string | null
          discount_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          minimum_cart_amount: number | null
          new_customers_only: boolean
          recurring_duration: string
          single_use_per_customer: boolean
          updated_at: string
          updated_by_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_form_draft: {
        Args: { p_definition: Json; p_form_id: string; p_request_id: string }
        Returns: {
          created_at: string
          created_by_profile_id: string
          form_id: string
          id: string
          information_html: string | null
          lifecycle_state: string
          published_at: string | null
          published_by_profile_id: string | null
          schema_hash: string | null
          title: string
          type_config: Json
          version_number: number
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "form_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_invoice: {
        Args: { p_invoice_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_my_profile: {
        Args: { p_display_name: string; p_notification_sound_enabled: boolean }
        Returns: {
          archived_at: string | null
          avatar_path: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          notification_sound_enabled: boolean
          role_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_order: {
        Args: { p_order_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          order_number: number
          priority: string
          service_id: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_organization: {
        Args: { p_name: string; p_organization_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_service: {
        Args: { p_patch: Json; p_service_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          created_at: string
          currency: string
          deadline_amount: number | null
          deadline_unit: string | null
          description: string | null
          folder_id: string | null
          group_quantities: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          recurring: boolean
          recurring_action: string | null
          recurring_interval_length: number | null
          recurring_interval_unit: string | null
          recurring_price: number | null
          require_client_profile: boolean
          sort_order: number
          subscription_eligible: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_service_folder: {
        Args: { p_folder_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_folders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_subscription_terms: {
        Args: {
          p_payload: Json
          p_request_id: string
          p_subscription_id: string
        }
        Returns: {
          anchor_day: number | null
          created_at: string
          created_by_profile_id: string
          currency: string
          effective_from: string
          end_of_month_policy: string
          grace_days: number
          id: string
          interval_count: number
          interval_unit: string
          lead_days: number
          recurring_action: string
          request_limit_active: number | null
          request_limit_total: number | null
          subscription_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "subscription_plan_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_task: {
        Args: { p_patch: Json; p_task_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          order_id: string
          sort_position: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_team_task_details: {
        Args: { p_patch: Json; p_task_id: string }
        Returns: Json
      }
      app_update_team_task_status: {
        Args: { p_status: string; p_task_id: string }
        Returns: Json
      }
      app_update_ticket_priority: {
        Args: { p_priority: string; p_ticket_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_update_ticket_status: {
        Args: { p_status: string; p_ticket_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_profile_id: string | null
          client_profile_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          inbox_added_at: string | null
          investment_service_id: string | null
          order_id: string | null
          priority: string
          public_ref: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source_form_submission_id: string | null
          source_form_version_id: string | null
          status: string
          subject: string
          ticket_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_validate_coupon: {
        Args: { p_cart_items: Json; p_cart_subtotal: number; p_code: string }
        Returns: Json
      }
      app_void_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          archived_at: string | null
          billing_reason: string | null
          client_profile_id: string | null
          company_id: string
          created_at: string
          created_by_profile_id: string
          currency: string
          discount_total_cents: number
          due_at: string | null
          id: string
          invoice_number: number | null
          issued_at: string | null
          status: string
          subtotal_cents: number
          tax_total_cents: number
          total_cents: number
          updated_at: string
          updated_by_profile_id: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


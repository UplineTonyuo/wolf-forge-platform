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
      companies: {
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
      profiles: {
        Row: {
          archived_at: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
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
      services: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_archive_company: {
        Args: { p_company_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
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
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
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
      app_create_company: {
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
      app_create_service: {
        Args: {
          p_description?: string
          p_is_active?: boolean
          p_name: string
          p_request_id: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
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
      app_update_company: {
        Args: { p_company_id: string; p_patch: Json }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
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
      app_update_service: {
        Args: { p_patch: Json; p_service_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
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

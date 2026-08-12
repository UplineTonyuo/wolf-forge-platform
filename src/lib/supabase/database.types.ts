export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type RoleRow = { id: string; name: string; created_at: string; updated_at: string };
export type ProfileRow = {
  id: string;
  role_id: string;
  company_id: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type CompanyRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type ClientContactRow = {
  id: string;
  company_id: string;
  profile_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type OrderRow = {
  id: string;
  order_number: number;
  company_id: string;
  service_id: string;
  assigned_to_profile_id: string | null;
  title: string;
  status: "pending" | "submitted" | "working" | "waiting_reply" | "pending_update" | "complete" | "canceled";
  priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type OrderTaskRow = {
  id: string;
  order_id: string;
  assigned_to_profile_id: string | null;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "blocked" | "complete" | "canceled";
  due_at: string | null;
  sort_position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type ActivityEventRow = {
  id: string;
  actor_profile_id: string | null;
  entity_type: "company" | "client_contact" | "service" | "order" | "order_task" | "profile";
  entity_id: string;
  action: string;
  summary: string;
  metadata: Json;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      roles: Table<RoleRow, { id?: string; name: string; created_at?: string; updated_at?: string }, Partial<RoleRow>>;
      profiles: Table<ProfileRow, { id: string; role_id: string; company_id?: string | null; display_name?: string | null; archived_at?: string | null }, Partial<ProfileRow>>;
      companies: Table<CompanyRow, { id?: string; name: string; archived_at?: string | null }, Partial<CompanyRow>>;
      client_contacts: Table<ClientContactRow, { id?: string; company_id: string; profile_id?: string | null; name: string; email?: string | null; phone?: string | null; job_title?: string | null; is_primary?: boolean; archived_at?: string | null }, Partial<ClientContactRow>>;
      services: Table<ServiceRow, { id?: string; name: string; description?: string | null; is_active?: boolean; archived_at?: string | null }, Partial<ServiceRow>>;
      orders: Table<OrderRow, { id?: string; company_id: string; service_id: string; assigned_to_profile_id?: string | null; title: string; status?: OrderRow["status"]; priority?: OrderRow["priority"]; due_at?: string | null; started_at?: string | null; completed_at?: string | null; notes?: string | null; archived_at?: string | null }, Partial<OrderRow>>;
      order_tasks: Table<OrderTaskRow, { id?: string; order_id: string; assigned_to_profile_id?: string | null; title: string; description?: string | null; status?: OrderTaskRow["status"]; due_at?: string | null; sort_position?: number; completed_at?: string | null; archived_at?: string | null }, Partial<OrderTaskRow>>;
      activity_events: Table<ActivityEventRow, { id?: string; actor_profile_id?: string | null; entity_type: ActivityEventRow["entity_type"]; entity_id: string; action: string; summary: string; metadata?: Json; created_at?: string }, never>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/**
 * Minimal hand-written Database types for the tables that exist as of
 * Milestone 1. Replace with `supabase gen types typescript` output once the
 * schema stabilizes across more milestones — kept small and accurate here
 * rather than generated-but-stale.
 */
export type OrganizationRole = "org_admin" | "team_manager" | "agent";
export type OrganizationUserStatus = "invited" | "active" | "inactive" | "suspended";
export type OrganizationStatus = "active" | "suspended";

export type TeamStatus = "active" | "inactive";
export type AssignmentMethod = "direct" | "round_robin" | "weighted_round_robin";
export type AvailabilityStatus = "available" | "busy" | "away" | "vacation" | "offline";
export type AttributeFieldType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "single_select"
  | "multi_select"
  | "email"
  | "phone"
  | "url";
export type ImportType = "users" | "territories";
export type ImportStatus =
  "pending" | "validating" | "ready" | "importing" | "completed" | "failed";
export type ImportRowStatus = "valid" | "invalid" | "imported" | "skipped";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: OrganizationStatus;
          settings: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: OrganizationStatus;
          settings?: Record<string, unknown>;
        };
        Update: Partial<{
          name: string;
          slug: string;
          status: OrganizationStatus;
          settings: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      organization_users: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: OrganizationRole;
          status: OrganizationUserStatus;
          invited_by_user_id: string | null;
          invited_at: string;
          activated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: OrganizationRole;
          status?: OrganizationUserStatus;
          invited_by_user_id?: string | null;
        };
        Update: Partial<{
          role: OrganizationRole;
          status: OrganizationUserStatus;
          activated_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "organization_users_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          default_organization_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          default_organization_id?: string | null;
        };
        Update: Partial<{
          full_name: string | null;
          avatar_url: string | null;
          default_organization_id: string | null;
        }>;
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          status: TeamStatus;
          default_assignment_method: AssignmentMethod;
          default_acceptance_deadline_minutes: number;
          default_fallback_user_id: string | null;
          timezone: string;
          operating_hours: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          status?: TeamStatus;
          default_assignment_method?: AssignmentMethod;
          default_acceptance_deadline_minutes?: number;
          default_fallback_user_id?: string | null;
          timezone?: string;
          operating_hours?: Record<string, unknown>;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          status: TeamStatus;
          default_assignment_method: AssignmentMethod;
          default_acceptance_deadline_minutes: number;
          default_fallback_user_id: string | null;
          timezone: string;
          operating_hours: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      team_users: {
        Row: {
          id: string;
          organization_id: string;
          team_id: string;
          user_id: string;
          is_manager: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          team_id: string;
          user_id: string;
          is_manager?: boolean;
        };
        Update: Partial<{
          is_manager: boolean;
        }>;
        Relationships: [];
      };
      user_availability: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          availability_status: AvailabilityStatus;
          status_note: string | null;
          updated_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          availability_status?: AvailabilityStatus;
          status_note?: string | null;
          updated_by_user_id?: string | null;
        };
        Update: Partial<{
          availability_status: AvailabilityStatus;
          status_note: string | null;
          updated_by_user_id: string | null;
        }>;
        Relationships: [];
      };
      user_assignment_settings: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          accept_leads: boolean;
          timezone: string;
          working_hours: Record<string, unknown>;
          daily_lead_limit: number;
          active_lead_limit: number;
          assignment_weight: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          accept_leads?: boolean;
          timezone?: string;
          working_hours?: Record<string, unknown>;
          daily_lead_limit?: number;
          active_lead_limit?: number;
          assignment_weight?: number;
        };
        Update: Partial<{
          accept_leads: boolean;
          timezone: string;
          working_hours: Record<string, unknown>;
          daily_lead_limit: number;
          active_lead_limit: number;
          assignment_weight: number;
        }>;
        Relationships: [];
      };
      recipient_attribute_definitions: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          internal_key: string;
          description: string | null;
          field_type: AttributeFieldType;
          required: boolean;
          default_value: unknown;
          options: unknown[];
          validation_rules: Record<string, unknown>;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          internal_key: string;
          description?: string | null;
          field_type: AttributeFieldType;
          required?: boolean;
          default_value?: unknown;
          options?: unknown[];
          validation_rules?: Record<string, unknown>;
          active?: boolean;
        };
        Update: Partial<{
          name: string;
          internal_key: string;
          description: string | null;
          field_type: AttributeFieldType;
          required: boolean;
          default_value: unknown;
          options: unknown[];
          validation_rules: Record<string, unknown>;
          active: boolean;
        }>;
        Relationships: [];
      };
      recipient_attribute_values: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          attribute_definition_id: string;
          value: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          attribute_definition_id: string;
          value: unknown;
        };
        Update: Partial<{
          value: unknown;
        }>;
        Relationships: [];
      };
      import_jobs: {
        Row: {
          id: string;
          organization_id: string;
          import_type: ImportType;
          status: ImportStatus;
          file_reference: string | null;
          column_mapping: Record<string, unknown>;
          summary: Record<string, unknown>;
          allow_partial: boolean;
          created_by_user_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          import_type: ImportType;
          status?: ImportStatus;
          file_reference?: string | null;
          column_mapping?: Record<string, unknown>;
          summary?: Record<string, unknown>;
          allow_partial?: boolean;
          created_by_user_id: string;
        };
        Update: Partial<{
          status: ImportStatus;
          column_mapping: Record<string, unknown>;
          summary: Record<string, unknown>;
          allow_partial: boolean;
        }>;
        Relationships: [];
      };
      import_rows: {
        Row: {
          id: string;
          organization_id: string;
          import_job_id: string;
          row_number: number;
          raw_data: Record<string, unknown>;
          status: ImportRowStatus;
          errors: unknown[];
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          import_job_id: string;
          row_number: number;
          raw_data: Record<string, unknown>;
          status?: ImportRowStatus;
          errors?: unknown[];
        };
        Update: Partial<{
          status: ImportRowStatus;
          errors: unknown[];
        }>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before_data: unknown;
          after_data: unknown;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          actor_user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          before_data?: unknown;
          after_data?: unknown;
          ip_address?: string | null;
          user_agent?: string | null;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_organization: {
        Args: { org_name: string; org_slug: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      is_active_org_member: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      is_org_admin: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      is_permitted_team_manager: {
        Args: { p_team_id: string };
        Returns: boolean;
      };
      find_auth_user_id_by_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
    };
  };
}

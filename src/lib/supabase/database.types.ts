/**
 * Minimal hand-written Database types for the tables that exist as of
 * Milestone 1. Replace with `supabase gen types typescript` output once the
 * schema stabilizes across more milestones — kept small and accurate here
 * rather than generated-but-stale.
 */
export type OrganizationRole = "org_admin" | "team_manager" | "agent";
export type OrganizationUserStatus = "invited" | "active" | "inactive" | "suspended";
export type OrganizationStatus = "active" | "suspended";

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
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_organization: {
        Args: { org_name: string; org_slug: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
    };
  };
}

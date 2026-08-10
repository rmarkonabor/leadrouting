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

export type LeadSourceType =
  "api" | "webhook" | "external_form" | "manual" | "csv" | "crm";
export type LeadSourceStatus = "active" | "inactive";
export type FieldMappingDestinationType = "default_field" | "custom_variable" | "ignored";
export type FieldMappingTransformation =
  | "trim"
  | "lowercase"
  | "uppercase"
  | "normalize_email"
  | "normalize_phone"
  | "parse_number"
  | "parse_currency"
  | "to_boolean"
  | "split_full_name"
  | "join_values"
  | "replace_values"
  | "apply_default";
export type SubmissionLogStatus =
  "received" | "validated" | "failed" | "resubmitted" | "ignored";
export type LeadDuplicateMatchBasis =
  | "idempotency_key"
  | "external_submission_id"
  | "email"
  | "phone"
  | "external_crm_record_id";
export type LeadDuplicateAction =
  "flag_and_continue" | "send_to_manual_review" | "update_existing" | "reject_submission";
export type LeadDuplicateStatus = "unique" | "possible_duplicate" | "duplicate";

export type TerritoryType =
  | "country"
  | "state_province"
  | "county"
  | "city"
  | "neighborhood"
  | "postal_code"
  | "radius";
export type TerritoryStatus = "active" | "inactive";
export type LocationNormalizationStatus =
  "confirmed" | "partial" | "ambiguous" | "invalid" | "not_provided";

export type RoutingFlowStatus = "draft" | "active" | "inactive" | "archived";
export type RoutingMatchType = "match_all" | "match_any";
export type AssignmentStatusValue =
  | "pending"
  | "notified"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired"
  | "reassigned"
  | "cancelled";
export type AssignmentAlgorithmValue =
  "direct" | "round_robin" | "weighted_round_robin" | "fallback" | "manual";
export type AssignmentAttemptOutcome = "assigned" | "no_eligible_user" | "manual_review";
export type ManualReviewReason =
  | "no_matching_rule"
  | "no_eligible_user"
  | "missing_required_data"
  | "missing_location"
  | "ambiguous_location"
  | "invalid_location"
  | "duplicate_review"
  | "all_users_at_capacity"
  | "all_users_unavailable"
  | "assignment_attempts_exhausted"
  | "manual_request"
  | "submission_mapping_error";
export type ManualReviewStatus = "open" | "resolved" | "dismissed";
export type RoutingActivityType =
  | "assignment_created"
  | "assignment_accepted"
  | "assignment_declined"
  | "assignment_expired"
  | "assignment_reassigned"
  | "manual_review_created"
  | "assignment_notified"
  | "assignment_viewed"
  | "manual_assignment"
  | "manual_reassignment"
  | "manual_review_resolved"
  | "status_changed"
  | "note_added";
export type IntegrationJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled"
  | "dead_letter";

export type IntegrationConnectionStatus = "connected" | "disconnected" | "error";
export type IntegrationLogStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "retrying"
  | "dead_letter"
  | "resolved";
export type WebhookEndpointStatus = "active" | "inactive";
export type WebhookDeliveryStatus =
  "queued" | "processing" | "delivered" | "failed" | "retrying" | "dead_letter";
export type WebhookEventType =
  | "lead.created"
  | "lead.assigned"
  | "lead.accepted"
  | "lead.declined"
  | "lead.reassigned"
  | "lead.status_changed"
  | "lead.converted"
  | "lead.lost";

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
      lead_sources: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          source_type: LeadSourceType;
          status: LeadSourceStatus;
          source_token_hash: string;
          default_routing_flow_id: string | null;
          rate_limit_settings: Record<string, unknown>;
          signature_settings: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          source_type: LeadSourceType;
          status?: LeadSourceStatus;
          source_token_hash: string;
          default_routing_flow_id?: string | null;
          rate_limit_settings?: Record<string, unknown>;
          signature_settings?: Record<string, unknown>;
        };
        Update: Partial<{
          name: string;
          status: LeadSourceStatus;
          source_token_hash: string;
          default_routing_flow_id: string | null;
          rate_limit_settings: Record<string, unknown>;
          signature_settings: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      api_tokens: {
        Row: {
          id: string;
          organization_id: string;
          lead_source_id: string;
          token_hash: string;
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_source_id: string;
          token_hash: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: Partial<{
          last_used_at: string | null;
          revoked_at: string | null;
        }>;
        Relationships: [];
      };
      field_mappings: {
        Row: {
          id: string;
          organization_id: string;
          lead_source_id: string;
          source_field_name: string;
          destination_type: FieldMappingDestinationType;
          destination_field: string | null;
          data_type: string;
          required: boolean;
          default_value: unknown;
          transformation: FieldMappingTransformation | null;
          validation_rule: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_source_id: string;
          source_field_name: string;
          destination_type: FieldMappingDestinationType;
          destination_field?: string | null;
          data_type: string;
          required?: boolean;
          default_value?: unknown;
          transformation?: FieldMappingTransformation | null;
          validation_rule?: Record<string, unknown>;
        };
        Update: Partial<{
          source_field_name: string;
          destination_type: FieldMappingDestinationType;
          destination_field: string | null;
          data_type: string;
          required: boolean;
          default_value: unknown;
          transformation: FieldMappingTransformation | null;
          validation_rule: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      custom_variable_definitions: {
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
      leads: {
        Row: {
          id: string;
          organization_id: string;
          first_name: string | null;
          last_name: string | null;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          street_address: string | null;
          unit_number: string | null;
          neighborhood: string | null;
          city: string | null;
          county: string | null;
          state_province: string | null;
          postal_code: string | null;
          country: string | null;
          lead_source_id: string | null;
          external_submission_id: string | null;
          message: string | null;
          campaign: string | null;
          medium: string | null;
          referrer: string | null;
          landing_page: string | null;
          email_consent: boolean;
          sms_consent: boolean;
          privacy_consent: boolean;
          consent_text: string | null;
          consent_timestamp: string | null;
          consent_ip: string | null;
          assigned_team_id: string | null;
          assigned_user_id: string | null;
          lead_status: string;
          assignment_status: string;
          priority: number;
          duplicate_status: LeadDuplicateStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          first_name?: string | null;
          last_name?: string | null;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          street_address?: string | null;
          unit_number?: string | null;
          neighborhood?: string | null;
          city?: string | null;
          county?: string | null;
          state_province?: string | null;
          postal_code?: string | null;
          country?: string | null;
          lead_source_id?: string | null;
          external_submission_id?: string | null;
          message?: string | null;
          campaign?: string | null;
          medium?: string | null;
          referrer?: string | null;
          landing_page?: string | null;
          email_consent?: boolean;
          sms_consent?: boolean;
          privacy_consent?: boolean;
          consent_text?: string | null;
          consent_timestamp?: string | null;
          consent_ip?: string | null;
          assigned_team_id?: string | null;
          assigned_user_id?: string | null;
          lead_status?: string;
          priority?: number;
          duplicate_status?: LeadDuplicateStatus;
        };
        Update: Partial<{
          lead_status: string;
          priority: number;
          assigned_team_id: string | null;
          assigned_user_id: string | null;
          duplicate_status: LeadDuplicateStatus;
        }>;
        Relationships: [];
      };
      lead_custom_values: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          variable_definition_id: string;
          value: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          variable_definition_id: string;
          value: unknown;
        };
        Update: Partial<{
          value: unknown;
        }>;
        Relationships: [];
      };
      lead_duplicates: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          duplicate_of_lead_id: string;
          match_basis: LeadDuplicateMatchBasis;
          action_taken: LeadDuplicateAction;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          duplicate_of_lead_id: string;
          match_basis: LeadDuplicateMatchBasis;
          action_taken: LeadDuplicateAction;
        };
        Update: never;
        Relationships: [];
      };
      submission_logs: {
        Row: {
          id: string;
          organization_id: string;
          lead_source_id: string;
          raw_payload: unknown;
          mapped_payload: unknown;
          validation_errors: unknown[];
          status: SubmissionLogStatus;
          idempotency_key: string | null;
          external_submission_id: string | null;
          test_mode: boolean;
          resulting_lead_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_source_id: string;
          raw_payload: unknown;
          mapped_payload?: unknown;
          validation_errors?: unknown[];
          status?: SubmissionLogStatus;
          idempotency_key?: string | null;
          external_submission_id?: string | null;
          test_mode?: boolean;
          resulting_lead_id?: string | null;
        };
        Update: Partial<{
          status: SubmissionLogStatus;
          resulting_lead_id: string | null;
          mapped_payload: unknown;
          validation_errors: unknown[];
        }>;
        Relationships: [];
      };
      territories: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          territory_type: TerritoryType;
          country: string | null;
          state_province: string | null;
          county: string | null;
          city: string | null;
          neighborhood: string | null;
          postal_code: string | null;
          center_geography: unknown;
          center_latitude: number | null;
          center_longitude: number | null;
          radius_distance: number | null;
          priority: number;
          status: TerritoryStatus;
          effective_start_date: string | null;
          effective_end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          territory_type: TerritoryType;
          country?: string | null;
          state_province?: string | null;
          county?: string | null;
          city?: string | null;
          neighborhood?: string | null;
          postal_code?: string | null;
          center_geography?: unknown;
          center_latitude?: number | null;
          center_longitude?: number | null;
          radius_distance?: number | null;
          priority?: number;
          status?: TerritoryStatus;
          effective_start_date?: string | null;
          effective_end_date?: string | null;
        };
        Update: Partial<{
          name: string;
          country: string | null;
          state_province: string | null;
          county: string | null;
          city: string | null;
          neighborhood: string | null;
          postal_code: string | null;
          priority: number;
          status: TerritoryStatus;
          effective_start_date: string | null;
          effective_end_date: string | null;
        }>;
        Relationships: [];
      };
      territory_users: {
        Row: {
          id: string;
          organization_id: string;
          territory_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          territory_id: string;
          user_id: string;
        };
        Update: never;
        Relationships: [];
      };
      territory_teams: {
        Row: {
          id: string;
          organization_id: string;
          territory_id: string;
          team_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          territory_id: string;
          team_id: string;
        };
        Update: never;
        Relationships: [];
      };
      lead_locations_internal: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          normalized_address: string | null;
          internal_latitude: number | null;
          internal_longitude: number | null;
          internal_geography: unknown;
          geographic_identifier: string | null;
          normalization_status: LocationNormalizationStatus;
          normalization_provider: string | null;
          normalization_metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          normalized_address?: string | null;
          internal_latitude?: number | null;
          internal_longitude?: number | null;
          geographic_identifier?: string | null;
          normalization_status?: LocationNormalizationStatus;
          normalization_provider?: string | null;
          normalization_metadata?: Record<string, unknown>;
        };
        Update: Partial<{
          normalized_address: string | null;
          internal_latitude: number | null;
          internal_longitude: number | null;
          geographic_identifier: string | null;
          normalization_status: LocationNormalizationStatus;
          normalization_provider: string | null;
          normalization_metadata: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      routing_flows: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          status: RoutingFlowStatus;
          default_team_id: string | null;
          default_user_id: string | null;
          acceptance_deadline_minutes: number;
          current_version_id: string | null;
          created_at: string;
          updated_at: string;
          published_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          status?: RoutingFlowStatus;
          default_team_id?: string | null;
          default_user_id?: string | null;
          acceptance_deadline_minutes?: number;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          status: RoutingFlowStatus;
          default_team_id: string | null;
          default_user_id: string | null;
          acceptance_deadline_minutes: number;
        }>;
        Relationships: [];
      };
      routing_flow_versions: {
        Row: {
          id: string;
          organization_id: string;
          routing_flow_id: string;
          version_number: number;
          published_at: string;
          published_by_user_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      routing_rules: {
        Row: {
          id: string;
          organization_id: string;
          routing_flow_id: string;
          name: string;
          priority: number;
          match_type: RoutingMatchType;
          conditions: unknown[];
          recipient_requirements: unknown[];
          action: Record<string, unknown>;
          stop_processing: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          routing_flow_id: string;
          name: string;
          priority?: number;
          match_type?: RoutingMatchType;
          conditions?: unknown[];
          recipient_requirements?: unknown[];
          action: Record<string, unknown>;
          stop_processing?: boolean;
        };
        Update: Partial<{
          name: string;
          priority: number;
          match_type: RoutingMatchType;
          conditions: unknown[];
          recipient_requirements: unknown[];
          action: Record<string, unknown>;
          stop_processing: boolean;
        }>;
        Relationships: [];
      };
      routing_rule_versions: {
        Row: {
          id: string;
          organization_id: string;
          routing_flow_version_id: string;
          name: string;
          priority: number;
          match_type: RoutingMatchType;
          conditions: unknown[];
          recipient_requirements: unknown[];
          action: Record<string, unknown>;
          stop_processing: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      routing_state: {
        Row: {
          id: string;
          organization_id: string;
          team_id: string;
          routing_flow_id: string;
          last_assigned_user_id: string | null;
          rotation_cursor: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      assignments: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          routing_flow_id: string | null;
          routing_flow_version_id: string | null;
          team_id: string | null;
          user_id: string | null;
          status: AssignmentStatusValue;
          assignment_algorithm: AssignmentAlgorithmValue;
          acceptance_deadline_at: string | null;
          notified_at: string | null;
          viewed_at: string | null;
          responded_at: string | null;
          explanation: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      assignment_attempts: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          assignment_id: string | null;
          routing_rule_version_id: string | null;
          eligible_team_ids: unknown[];
          eligible_user_ids: unknown[];
          excluded: unknown[];
          selected_user_id: string | null;
          outcome: AssignmentAttemptOutcome;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      manual_review_items: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          reason: ManualReviewReason;
          status: ManualReviewStatus;
          resolved_by_user_id: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: Partial<{
          status: ManualReviewStatus;
          resolved_by_user_id: string | null;
          resolved_at: string | null;
        }>;
        Relationships: [];
      };
      activities: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          activity_type: RoutingActivityType;
          actor_user_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          activity_type: RoutingActivityType;
          actor_user_id?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          event_type: string;
          lead_id: string | null;
          assignment_id: string | null;
          title: string;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: Partial<{ read_at: string | null }>;
        Relationships: [];
      };
      integration_jobs: {
        Row: {
          id: string;
          organization_id: string;
          queue_name: string;
          job_type: string;
          payload: Record<string, unknown>;
          status: IntegrationJobStatus;
          attempt_count: number;
          next_retry_at: string | null;
          dedupe_key: string;
          queue_msg_id: number | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lead_status_definitions: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          label: string;
          sort_order: number;
          is_default_set: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          key: string;
          label: string;
          sort_order?: number;
          is_default_set?: boolean;
          active?: boolean;
        };
        Update: Partial<{ label: string; sort_order: number; active: boolean }>;
        Relationships: [];
      };
      lead_status_history: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          from_status: string | null;
          to_status: string;
          changed_by_user_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          author_user_id: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      routing_health_metrics: {
        Row: {
          id: string;
          organization_id: string;
          bucket_start: string;
          bucket_end: string;
          leads_received: number;
          leads_assigned: number;
          leads_awaiting_acceptance: number;
          assignments_expired: number;
          leads_reassigned: number;
          leads_in_manual_review: number;
          no_matching_rule_count: number;
          no_eligible_user_count: number;
          users_at_capacity_count: number;
          unavailable_users_count: number;
          territories_without_users_count: number;
          territory_conflicts_count: number;
          crm_sync_failures: number;
          webhook_failures: number;
          median_routing_time_ms: number | null;
          median_acceptance_time_ms: number | null;
          assignment_success_rate: number | null;
          manual_routing_rate: number | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      integration_connections: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          status: IntegrationConnectionStatus;
          credentials_encrypted: string | null;
          settings: Record<string, unknown>;
          connected_by_user_id: string | null;
          connected_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider: string;
          status?: IntegrationConnectionStatus;
          credentials_encrypted?: string | null;
          settings?: Record<string, unknown>;
          connected_by_user_id?: string | null;
          connected_at?: string | null;
        };
        Update: Partial<{
          status: IntegrationConnectionStatus;
          credentials_encrypted: string | null;
          settings: Record<string, unknown>;
          connected_by_user_id: string | null;
          connected_at: string | null;
        }>;
        Relationships: [];
      };
      integration_field_mappings: {
        Row: {
          id: string;
          organization_id: string;
          integration_connection_id: string;
          source_field: string;
          crm_field: string;
          transformation: FieldMappingTransformation | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          integration_connection_id: string;
          source_field: string;
          crm_field: string;
          transformation?: FieldMappingTransformation | null;
        };
        Update: Partial<{
          source_field: string;
          crm_field: string;
          transformation: FieldMappingTransformation | null;
        }>;
        Relationships: [];
      };
      external_record_links: {
        Row: {
          id: string;
          organization_id: string;
          integration_connection_id: string;
          lead_id: string;
          provider: string;
          external_record_id: string;
          created_at: string;
          updated_at: string;
        };
        // Written only by the service-role crm_sync consumer (never a
        // user-facing module) — RLS has no INSERT policy for `authenticated`.
        Insert: {
          id?: string;
          organization_id: string;
          integration_connection_id: string;
          lead_id: string;
          provider: string;
          external_record_id: string;
        };
        Update: never;
        Relationships: [];
      };
      integration_logs: {
        Row: {
          id: string;
          organization_id: string;
          integration_job_id: string | null;
          provider: string;
          event_type: string;
          lead_id: string | null;
          request_summary: Record<string, unknown> | null;
          response_summary: Record<string, unknown> | null;
          status: IntegrationLogStatus;
          attempt_count: number;
          next_retry_at: string | null;
          created_at: string;
          completed_at: string | null;
        };
        // Written only by the service-role crm_sync consumer.
        Insert: {
          id?: string;
          organization_id: string;
          integration_job_id?: string | null;
          provider: string;
          event_type: string;
          lead_id?: string | null;
          request_summary?: Record<string, unknown> | null;
          response_summary?: Record<string, unknown> | null;
          status?: IntegrationLogStatus;
          attempt_count?: number;
          completed_at?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      webhook_endpoints: {
        Row: {
          id: string;
          organization_id: string;
          url: string;
          secret_encrypted: string;
          subscribed_events: WebhookEventType[];
          status: WebhookEndpointStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          url: string;
          secret_encrypted: string;
          subscribed_events?: WebhookEventType[];
          status?: WebhookEndpointStatus;
        };
        Update: Partial<{
          url: string;
          secret_encrypted: string;
          subscribed_events: WebhookEventType[];
          status: WebhookEndpointStatus;
        }>;
        Relationships: [];
      };
      webhook_deliveries: {
        Row: {
          id: string;
          organization_id: string;
          webhook_endpoint_id: string;
          integration_job_id: string | null;
          event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          status: WebhookDeliveryStatus;
          attempt_count: number;
          next_retry_at: string | null;
          last_response_status: number | null;
          created_at: string;
          completed_at: string | null;
        };
        // Written only by the service-role outbound_webhooks consumer.
        Insert: {
          id?: string;
          organization_id: string;
          webhook_endpoint_id: string;
          integration_job_id?: string | null;
          event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          status?: WebhookDeliveryStatus;
          attempt_count?: number;
          last_response_status?: number | null;
          completed_at?: string | null;
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
      resolve_lead_source: {
        Args: { p_token_hash: string };
        Returns: {
          lead_source_id: string;
          organization_id: string;
          status: LeadSourceStatus;
          rate_limit_settings: Record<string, unknown>;
          signature_settings: Record<string, unknown>;
        }[];
      };
      check_and_increment_intake_rate_limit: {
        Args: {
          p_lead_source_id: string;
          p_window_seconds: number;
          p_max_requests: number;
        };
        Returns: boolean;
      };
      record_lead_submission: {
        Args: {
          p_lead_source_id: string;
          p_idempotency_key: string | null;
          p_external_submission_id: string | null;
          p_raw_payload: unknown;
          p_mapped_payload: unknown;
          p_validation_errors: unknown;
          p_submission_status: SubmissionLogStatus;
          p_test_mode: boolean;
          p_lead_fields: unknown;
          p_lead_duplicate_status: LeadDuplicateStatus | null;
          p_custom_values: unknown;
          p_duplicate_of_lead_id: string | null;
          p_match_basis: LeadDuplicateMatchBasis | null;
          p_duplicate_action: LeadDuplicateAction | null;
        };
        Returns: { submission_log_id: string; lead_id: string | null }[];
      };
      is_postgis_available: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      publish_routing_flow: {
        Args: { p_routing_flow_id: string };
        Returns: Database["public"]["Tables"]["routing_flow_versions"]["Row"];
      };
      route_lead: {
        Args: { p_lead_id: string };
        Returns: Record<string, unknown>;
      };
      simulate_routing: {
        Args: { p_lead_id: string };
        Returns: Record<string, unknown>;
      };
      accept_assignment: {
        Args: { p_assignment_id: string };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      decline_assignment: {
        Args: { p_assignment_id: string };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      expire_assignment: {
        Args: { p_assignment_id: string };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      reassign_lead: {
        Args: { p_lead_id: string };
        Returns: Record<string, unknown>;
      };
      mark_assignment_viewed: {
        Args: { p_assignment_id: string };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      manually_assign_lead: {
        Args: { p_lead_id: string; p_user_id: string; p_team_id: string | null };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      manually_reassign_lead: {
        Args: { p_lead_id: string; p_user_id: string; p_team_id: string | null };
        Returns: Database["public"]["Tables"]["assignments"]["Row"];
      };
      run_expire_assignments: {
        Args: Record<string, never>;
        Returns: number;
      };
      run_send_expiration_warnings: {
        Args: { p_warn_at_fraction?: number };
        Returns: number;
      };
      dequeue_assignment_notifications: {
        Args: { p_batch_size?: number; p_visibility_timeout_seconds?: number };
        Returns: { msg_id: number; payload: Record<string, unknown>; read_ct: number }[];
      };
      ack_assignment_notification: {
        Args: { p_msg_id: number; p_job_id: string };
        Returns: undefined;
      };
      fail_assignment_notification: {
        Args: {
          p_msg_id: number;
          p_job_id: string;
          p_error: string;
          p_max_attempts?: number;
        };
        Returns: undefined;
      };
      record_notification: {
        Args: {
          p_organization_id: string;
          p_user_id: string;
          p_event_type: string;
          p_lead_id: string | null;
          p_assignment_id: string | null;
          p_title: string;
          p_body: string;
        };
        Returns: Database["public"]["Tables"]["notifications"]["Row"];
      };
      update_lead_status: {
        Args: { p_lead_id: string; p_new_status: string };
        Returns: Database["public"]["Tables"]["leads"]["Row"];
      };
      add_note: {
        Args: { p_lead_id: string; p_content: string };
        Returns: Database["public"]["Tables"]["notes"]["Row"];
      };
      compute_routing_health: {
        Args: { p_organization_id: string; p_bucket_start: string; p_bucket_end: string };
        Returns: {
          leadsReceived: number;
          leadsAssigned: number;
          leadsAwaitingAcceptance: number;
          assignmentsExpired: number;
          leadsReassigned: number;
          leadsInManualReview: number;
          noMatchingRuleCount: number;
          noEligibleUserCount: number;
          usersAtCapacityCount: number;
          unavailableUsersCount: number;
          territoriesWithoutUsersCount: number;
          territoryConflictsCount: number;
          crmSyncFailures: number;
          webhookFailures: number;
          medianRoutingTimeMs: number | null;
          medianAcceptanceTimeMs: number | null;
          assignmentSuccessRate: number | null;
          manualRoutingRate: number | null;
        };
      };
      enqueue_integration_job: {
        Args: {
          p_organization_id: string;
          p_queue_name: string;
          p_job_type: string;
          p_dedupe_key: string;
          p_payload: unknown;
        };
        Returns: string | null;
      };
      dequeue_integration_jobs: {
        Args: {
          p_queue_name: string;
          p_batch_size?: number;
          p_visibility_timeout_seconds?: number;
        };
        Returns: { msg_id: number; payload: Record<string, unknown>; read_ct: number }[];
      };
      ack_integration_job: {
        Args: { p_queue_name: string; p_msg_id: number; p_job_id: string };
        Returns: undefined;
      };
      fail_integration_job: {
        Args: {
          p_queue_name: string;
          p_msg_id: number | null;
          p_job_id: string;
          p_error: string;
          p_max_attempts?: number;
        };
        Returns: undefined;
      };
      run_drain_crm_sync_retries: {
        Args: Record<string, never>;
        Returns: number;
      };
      run_drain_webhook_retries: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_integration_log_resolved: {
        Args: { p_log_id: string };
        Returns: Database["public"]["Tables"]["integration_logs"]["Row"];
      };
      retry_integration_job: {
        Args: { p_job_id: string };
        Returns: Database["public"]["Tables"]["integration_jobs"]["Row"];
      };
      get_connection_for_inbound_webhook: {
        Args: { p_connection_id: string };
        Returns: {
          organization_id: string;
          provider: string;
          settings: Record<string, unknown>;
          credentials_encrypted: string | null;
        }[];
      };
      apply_inbound_crm_status_change: {
        Args: {
          p_connection_id: string;
          p_external_record_id: string;
          p_crm_status: string;
        };
        Returns: Record<string, unknown>;
      };
    };
  };
}

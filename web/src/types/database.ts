// Database types matching the Rust backend schema
// Auto-generated types can be created with: npx supabase gen types typescript

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "owner" | "admin" | "member" | "viewer";

// Helper functions for role permissions
export const roleLevel = (role: UserRole): number => {
  switch (role) {
    case "owner": return 3;
    case "admin": return 2;
    case "member": return 1;
    case "viewer": return 0;
  }
};

export const canManage = (role: UserRole): boolean => roleLevel(role) >= 1;
export const canAdminister = (role: UserRole): boolean => roleLevel(role) >= 2;
export const isOwner = (role: UserRole): boolean => role === "owner";
export type SubscriptionTier = "free" | "starter" | "pro" | "enterprise";
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing";
export type InviteStatus = "pending" | "accepted" | "expired";

// MCP Tool/Resource types (returned from MCP servers during health checks)
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Json;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          avatar_url?: string | null;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          avatar_url?: string | null;
          is_admin?: boolean;
          updated_at?: string;
        };
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
          subscription_tier: SubscriptionTier;
          subscription_status: SubscriptionStatus;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          owner_id: string;
          subscription_tier?: SubscriptionTier;
          subscription_status?: SubscriptionStatus;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          subscription_tier?: SubscriptionTier;
          subscription_status?: SubscriptionStatus;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          settings?: Json;
          updated_at?: string;
        };
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: UserRole;
          joined_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: UserRole;
          joined_at?: string;
          created_at?: string;
        };
        Update: {
          role?: UserRole;
        };
      };
      organization_invites: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: UserRole;
          token: string;
          status: InviteStatus;
          invited_by: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email: string;
          role?: UserRole;
          token: string;
          status?: InviteStatus;
          invited_by: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          status?: InviteStatus;
        };
      };
      mcps: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          endpoint_url: string;
          is_active: boolean;
          config: Json;
          created_at: string;
          updated_at: string;
          // Health check fields
          health_status?: "healthy" | "unhealthy" | "unknown";
          last_health_check?: string | null;
          last_latency_ms?: number | null;
          tools_count?: number | null;
          resources_count?: number | null;
          protocol_version?: string | null;
          server_name?: string | null;
          server_version?: string | null;
          // Full tool/resource data (populated during health checks)
          tools_json?: MCPTool[] | null;
          resources_json?: MCPResource[] | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          endpoint_url: string;
          is_active?: boolean;
          config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          endpoint_url?: string;
          is_active?: boolean;
          config?: Json;
          updated_at?: string;
        };
      };
      api_keys: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes: string[];
          last_used_at: string | null;
          expires_at: string | null;
          created_by: string;
          created_at: string;
          /** MCP access mode: "all", "selected", or "none" */
          mcp_access_mode?: "all" | "selected" | "none";
          /** When mcp_access_mode is "selected", the list of allowed MCP IDs */
          allowed_mcp_ids?: string[] | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes?: string[];
          expires_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          scopes?: string[];
          last_used_at?: string | null;
          expires_at?: string | null;
        };
      };
      usage_logs: {
        Row: {
          id: string;
          organization_id: string;
          mcp_id: string | null;
          api_key_id: string | null;
          event_type: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          mcp_id?: string | null;
          api_key_id?: string | null;
          event_type: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          action: string;
          resource_type: string;
          resource_id: string | null;
          metadata: Json;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      subscription_tier: SubscriptionTier;
      subscription_status: SubscriptionStatus;
      invite_status: InviteStatus;
    };
  };
}

// Helper types for easier usage
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember = Database["public"]["Tables"]["organization_members"]["Row"];
export type OrganizationInvite = Database["public"]["Tables"]["organization_invites"]["Row"];
export type MCP = Database["public"]["Tables"]["mcps"]["Row"];
export type ApiKey = Database["public"]["Tables"]["api_keys"]["Row"];
export type UsageLog = Database["public"]["Tables"]["usage_logs"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

// Extended types with relations
export interface UserWithOrganizations extends User {
  memberships: (OrganizationMember & { organization: Organization })[];
}

export interface OrganizationWithMembers extends Organization {
  members: (OrganizationMember & { user: User })[];
}

export interface MCPWithUsage extends MCP {
  total_requests: number;
  last_request_at: string | null;
}

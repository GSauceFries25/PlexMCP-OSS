import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  type AdminUserResponse,
  type AdminUpdateUserRequest,
  type AdminSetUsageRequest,
  type AdminSetUsageResponse,
  type AdminSuspendUserRequest,
  type AdminSuspendUserResponse,
  type AdminRevokeSessionsResponse,
  type AdminForcePasswordResetResponse,
  type AdminDisable2FAResponse,
  type AdminDeleteUserResponse,
  type AdminRevokeApiKeyResponse,
  type PaginatedResponse,
  type OrgCustomLimitsResponse,
  type SetCustomLimitsRequest,
  type LimitChangeHistoryResponse,
} from "../client";
import type { User, Organization } from "@/types/database";

// Query keys
export const adminKeys = {
  users: (page: number, perPage: number) => ["admin", "users", page, perPage] as const,
  user: (userId: string) => ["admin", "users", userId] as const,
  organizations: (page: number, perPage: number) => ["admin", "organizations", page, perPage] as const,
  stats: () => ["admin", "stats"] as const,
  orgLimits: (orgId: string) => ["admin", "orgs", orgId, "limits"] as const,
  limitHistory: (orgId: string, page: number) => ["admin", "orgs", orgId, "limits", "history", page] as const,
};

// Platform stats type
export interface PlatformStats {
  total_users: number;
  total_organizations: number;
  total_mcps: number;
  total_requests_today: number;
  revenue_mtd: number;
}

// Backend response type (different from frontend PaginatedResponse)
interface AdminUsersBackendResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

// Backend response type for organizations
interface AdminOrgsBackendResponse {
  organizations: Organization[];
  total: number;
  page?: number;
  limit?: number;
}

// Get all users (paginated)
export function useAdminUsers(page = 1, perPage = 50, enabled = true) {
  return useQuery({
    queryKey: adminKeys.users(page, perPage),
    queryFn: async () => {
      const response = await apiClient.adminGetAllUsers({ page, per_page: perPage });
      if (response.error) {
        throw new Error(response.error.message);
      }
      // Transform backend response to match frontend PaginatedResponse
      // The backend returns { users, total, page, limit } but frontend expects { items, ... }
      const backendData = response.data as unknown as AdminUsersBackendResponse;
      const totalPages = Math.ceil(backendData.total / perPage);
      return {
        items: backendData.users || [],
        total: backendData.total,
        page: backendData.page,
        per_page: backendData.limit,
        total_pages: totalPages,
      } as PaginatedResponse<User>;
    },
    enabled,
  });
}

// Get single user by ID
export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: adminKeys.user(userId),
    queryFn: async () => {
      const response = await apiClient.adminGetUser(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminUserResponse;
    },
    enabled: !!userId,
  });
}

// Update user mutation
export function useAdminUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: AdminUpdateUserRequest }) => {
      const response = await apiClient.adminUpdateUser(userId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminUserResponse;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(variables.userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Get all organizations (paginated)
export function useAdminOrganizations(page = 1, perPage = 50, enabled = true) {
  return useQuery({
    queryKey: adminKeys.organizations(page, perPage),
    queryFn: async () => {
      const response = await apiClient.adminGetAllOrganizations({ page, per_page: perPage });
      if (response.error) {
        throw new Error(response.error.message);
      }
      // Transform backend response to match frontend PaginatedResponse
      // The backend returns { organizations, total } but frontend expects { items, ... }
      const backendData = response.data as unknown as AdminOrgsBackendResponse;
      const totalPages = Math.ceil(backendData.total / perPage);
      return {
        items: backendData.organizations || [],
        total: backendData.total,
        page: backendData.page || page,
        per_page: backendData.limit || perPage,
        total_pages: totalPages,
      } as PaginatedResponse<Organization>;
    },
    enabled,
  });
}

// Get platform stats
export function useAdminStats(enabled = true) {
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: async () => {
      const response = await apiClient.adminGetPlatformStats();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as PlatformStats;
    },
    refetchInterval: enabled ? 30000 : false, // Auto-refresh every 30s only when enabled
    enabled,
  });
}

// Set usage mutation
export function useAdminSetUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AdminSetUsageRequest) => {
      const response = await apiClient.adminSetUsage(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminSetUsageResponse;
    },
    onSuccess: () => {
      // Invalidate all admin queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      // Also invalidate billing usage for the affected org
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// Reset usage mutation
export function useAdminResetUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orgId: string) => {
      const response = await apiClient.adminResetUsage(orgId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminSetUsageResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// =============================================================================
// Admin User Action Mutations
// =============================================================================

// Revoke all sessions for a user
export function useAdminRevokeUserSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.adminRevokeUserSessions(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminRevokeSessionsResponse;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Force password reset for a user
export function useAdminForcePasswordReset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.adminForcePasswordReset(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminForcePasswordResetResponse;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Disable 2FA for a user
export function useAdminDisable2FA() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.adminDisable2FA(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminDisable2FAResponse;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Suspend a user
export function useAdminSuspendUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      const response = await apiClient.adminSuspendUser(userId, { reason });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminSuspendUserResponse;
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Unsuspend a user
export function useAdminUnsuspendUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.adminUnsuspendUser(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminSuspendUserResponse;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Delete a user
export function useAdminDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.adminDeleteUser(userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminDeleteUserResponse;
    },
    onSuccess: () => {
      // Invalidate all user queries since the user is deleted
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });
}

// Revoke a user's API key
export function useAdminRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, keyId }: { userId: string; keyId: string }) => {
      const response = await apiClient.adminRevokeUserApiKey(userId, keyId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminRevokeApiKeyResponse;
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// =============================================================================
// Enterprise Custom Limits Hooks
// =============================================================================

// Get organization's current and effective limits
export function useAdminOrgLimits(orgId: string, enabled = true) {
  return useQuery({
    queryKey: adminKeys.orgLimits(orgId),
    queryFn: async () => {
      const response = await apiClient.adminGetOrgLimits(orgId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OrgCustomLimitsResponse;
    },
    enabled: !!orgId && enabled,
  });
}

// Set or update custom limits for an organization
export function useAdminSetOrgLimits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orgId, data }: { orgId: string; data: SetCustomLimitsRequest }) => {
      const response = await apiClient.adminSetOrgLimits(orgId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OrgCustomLimitsResponse;
    },
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.orgLimits(orgId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "orgs", orgId, "limits", "history"] });
    },
  });
}

// Clear all custom limits for an organization (revert to tier defaults)
export function useAdminClearOrgLimits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orgId: string) => {
      const response = await apiClient.adminClearOrgLimits(orgId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OrgCustomLimitsResponse;
    },
    onSuccess: (_, orgId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.orgLimits(orgId) });
      queryClient.invalidateQueries({ queryKey: ["admin", "orgs", orgId, "limits", "history"] });
    },
  });
}

// Get limit change history for an organization
export function useAdminLimitHistory(orgId: string, page = 1, perPage = 20, enabled = true) {
  return useQuery({
    queryKey: adminKeys.limitHistory(orgId, page),
    queryFn: async () => {
      const response = await apiClient.adminGetLimitHistory(orgId, { page, per_page: perPage });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as LimitChangeHistoryResponse;
    },
    enabled: !!orgId && enabled,
  });
}

// Get a single organization by ID (fetches from paginated list and finds the org)
export function useAdminOrganization(orgId: string, enabled = true) {
  return useQuery({
    queryKey: ["admin", "organization", orgId],
    queryFn: async () => {
      // Fetch first page with large page size to find the org
      const response = await apiClient.adminGetAllOrganizations({ page: 1, per_page: 500 });
      if (response.error) {
        throw new Error(response.error.message);
      }
      // The backend returns { organizations, total }
      const backendData = response.data as unknown as { organizations: Organization[]; total: number };
      const org = backendData.organizations?.find((o: Organization) => o.id === orgId);
      if (!org) {
        throw new Error("Organization not found");
      }
      return org;
    },
    enabled: !!orgId && enabled,
  });
}

// =============================================================================
// Overages Management Hooks
// =============================================================================

export interface OrgOveragesResponse {
  org_id: string;
  org_name: string;
  overages_disabled: boolean;
  subscription_tier: string;
  reason: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface ToggleOveragesRequest {
  disable_overages: boolean;
  reason?: string;
}

// Get organization's overages status
export function useAdminOrgOverages(orgId: string, enabled = true) {
  return useQuery({
    queryKey: ["admin", "orgs", orgId, "overages"],
    queryFn: async () => {
      const response = await apiClient.adminGetOrgOverages(orgId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OrgOveragesResponse;
    },
    enabled: !!orgId && enabled,
  });
}

// Toggle overages for an organization
export function useAdminToggleOrgOverages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orgId, data }: { orgId: string; data: ToggleOveragesRequest }) => {
      const response = await apiClient.adminToggleOrgOverages(orgId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OrgOveragesResponse;
    },
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "orgs", orgId, "overages"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

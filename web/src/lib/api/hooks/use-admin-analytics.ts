import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../client";
import type {
  AdminUsageSummaryResponse,
  AdminUsageTimeSeriesResponse,
  AdminRevenueMetricsResponse,
  AdminUserActivityResponse,
  AdminTopMcpsResponse,
  AdminTopOrgsResponse,
  AdminSpendCapUtilizationResponse,
} from "../client";

// Query keys
export const adminAnalyticsKeys = {
  usageSummary: (params?: { start?: string; end?: string }) =>
    ["admin", "analytics", "usage", "summary", params] as const,
  usageTimeSeries: (params?: { start?: string; end?: string; granularity?: string }) =>
    ["admin", "analytics", "usage", "timeseries", params] as const,
  revenue: () => ["admin", "analytics", "revenue"] as const,
  userActivity: () => ["admin", "analytics", "users"] as const,
  topMcps: (params?: { start?: string; end?: string }) =>
    ["admin", "analytics", "top-mcps", params] as const,
  topOrgs: (params?: { start?: string; end?: string }) =>
    ["admin", "analytics", "top-orgs", params] as const,
  spendCaps: () => ["admin", "analytics", "spend-caps"] as const,
};

// =============================================================================
// Usage Analytics Hooks
// =============================================================================

/** Get platform usage summary */
export function useAdminUsageSummary(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: adminAnalyticsKeys.usageSummary(params),
    queryFn: async () => {
      const response = await apiClient.adminGetUsageSummary(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminUsageSummaryResponse;
    },
    enabled,
    refetchInterval: 60000, // Refresh every minute
  });
}

/** Get usage time series data */
export function useAdminUsageTimeSeries(
  params?: { start?: string; end?: string; granularity?: "hourly" | "daily" | "weekly" },
  enabled = true
) {
  return useQuery({
    queryKey: adminAnalyticsKeys.usageTimeSeries(params),
    queryFn: async () => {
      const response = await apiClient.adminGetUsageTimeSeries(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminUsageTimeSeriesResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Revenue Analytics Hooks
// =============================================================================

/** Get revenue metrics */
export function useAdminRevenueMetrics(enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.revenue(),
    queryFn: async () => {
      const response = await apiClient.adminGetRevenueMetrics();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminRevenueMetricsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// User Activity Hooks
// =============================================================================

/** Get user activity metrics (DAU/WAU/MAU) */
export function useAdminUserActivity(enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.userActivity(),
    queryFn: async () => {
      const response = await apiClient.adminGetUserActivity();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminUserActivityResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Top Entities Hooks
// =============================================================================

/** Get top MCPs by usage */
export function useAdminTopMcps(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: adminAnalyticsKeys.topMcps(params),
    queryFn: async () => {
      const response = await apiClient.adminGetTopMcps(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminTopMcpsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

/** Get top organizations by usage */
export function useAdminTopOrgs(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: adminAnalyticsKeys.topOrgs(params),
    queryFn: async () => {
      const response = await apiClient.adminGetTopOrgs(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminTopOrgsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Spend Cap Hooks
// =============================================================================

/** Get spend cap utilization across platform */
export function useAdminSpendCapUtilization(enabled = true) {
  return useQuery({
    queryKey: adminAnalyticsKeys.spendCaps(),
    queryFn: async () => {
      const response = await apiClient.adminGetSpendCapUtilization();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AdminSpendCapUtilizationResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

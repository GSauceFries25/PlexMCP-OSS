import { useQuery } from "@tanstack/react-query";
import {
  apiClient,
  type UsageStats,
  type UsageSummaryResponse,
  type HourlyUsageItem,
  type McpUsageItem,
  type RecentErrorItem,
  type LatencyDistributionResponse,
} from "../client";

// Time range types
export type TimeRange = "24h" | "7d" | "30d" | "90d";

// Helper to calculate date range from time range string
export function getTimeRangeDates(range: TimeRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case "24h":
      start.setHours(start.getHours() - 24);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// Query keys
export const usageKeys = {
  stats: (orgId: string) => ["organizations", orgId, "usage"] as const,
  logs: (orgId: string) => ["organizations", orgId, "usage", "logs"] as const,
  auditLogs: (orgId: string) => ["organizations", orgId, "audit-logs"] as const,
  // New time-range-aware keys
  summary: (orgId: string, timeRange: TimeRange) =>
    ["organizations", orgId, "usage", "summary", timeRange] as const,
  hourly: (orgId: string, timeRange: TimeRange) =>
    ["organizations", orgId, "usage", "hourly", timeRange] as const,
  byMcp: (orgId: string, timeRange: TimeRange) =>
    ["organizations", orgId, "usage", "by-mcp", timeRange] as const,
  errors: (orgId: string, timeRange: TimeRange) =>
    ["organizations", orgId, "usage", "errors", timeRange] as const,
  latencyDistribution: (orgId: string, timeRange: TimeRange) =>
    ["organizations", orgId, "usage", "latency-distribution", timeRange] as const,
};

// Get usage stats for an organization (legacy)
export function useUsageStats(organizationId: string) {
  return useQuery({
    queryKey: usageKeys.stats(organizationId),
    queryFn: async () => {
      const response = await apiClient.getUsageStats(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as UsageStats;
    },
    enabled: !!organizationId,
  });
}

// Get usage summary with time range
export function useUsageSummary(organizationId: string, timeRange: TimeRange = "7d") {
  const { start, end } = getTimeRangeDates(timeRange);

  return useQuery({
    queryKey: usageKeys.summary(organizationId, timeRange),
    queryFn: async () => {
      const response = await apiClient.getUsageSummary(organizationId, { start, end });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as UsageSummaryResponse;
    },
    enabled: !!organizationId,
  });
}

// Get hourly usage data for charts
export function useHourlyUsage(organizationId: string, timeRange: TimeRange = "7d") {
  const { start, end } = getTimeRangeDates(timeRange);

  return useQuery({
    queryKey: usageKeys.hourly(organizationId, timeRange),
    queryFn: async () => {
      const response = await apiClient.getHourlyUsage(organizationId, { start, end });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as HourlyUsageItem[];
    },
    enabled: !!organizationId,
  });
}

// Get usage breakdown by MCP
export function useMcpUsage(organizationId: string, timeRange: TimeRange = "7d") {
  const { start, end } = getTimeRangeDates(timeRange);

  return useQuery({
    queryKey: usageKeys.byMcp(organizationId, timeRange),
    queryFn: async () => {
      const response = await apiClient.getUsageByMcp(organizationId, { start, end });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as McpUsageItem[];
    },
    enabled: !!organizationId,
  });
}

// Get recent errors
export function useRecentErrors(
  organizationId: string,
  timeRange: TimeRange = "7d",
  limit: number = 10
) {
  const { start, end } = getTimeRangeDates(timeRange);

  return useQuery({
    queryKey: [...usageKeys.errors(organizationId, timeRange), limit],
    queryFn: async () => {
      const response = await apiClient.getRecentErrors(organizationId, { start, end, limit });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as RecentErrorItem[];
    },
    enabled: !!organizationId,
  });
}

// Get latency distribution
export function useLatencyDistribution(organizationId: string, timeRange: TimeRange = "7d") {
  const { start, end } = getTimeRangeDates(timeRange);

  return useQuery({
    queryKey: usageKeys.latencyDistribution(organizationId, timeRange),
    queryFn: async () => {
      const response = await apiClient.getLatencyDistribution(organizationId, { start, end });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as LatencyDistributionResponse;
    },
    enabled: !!organizationId,
  });
}

// Get usage logs for an organization
export function useUsageLogs(organizationId: string, page = 1, perPage = 20) {
  return useQuery({
    queryKey: [...usageKeys.logs(organizationId), page, perPage],
    queryFn: async () => {
      const response = await apiClient.getUsageLogs(organizationId, { page, per_page: perPage });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    enabled: !!organizationId,
  });
}

// Get audit logs for an organization
export function useAuditLogs(organizationId: string, page = 1, perPage = 20) {
  return useQuery({
    queryKey: [...usageKeys.auditLogs(organizationId), page, perPage],
    queryFn: async () => {
      const response = await apiClient.getAuditLogs(organizationId, { page, per_page: perPage });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    enabled: !!organizationId,
  });
}

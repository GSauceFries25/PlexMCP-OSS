import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../client";
import type {
  WebsiteRealtimeResponse,
  WebsiteOverviewResponse,
  WebsiteOverviewEnhancedResponse,
  WebsiteTopPagesResponse,
  WebsiteReferrersResponse,
  WebsiteDevicesResponse,
  WebsiteLocationsResponse,
  WebsiteTimeseriesResponse,
  WebsiteEventsResponse,
  WebsiteEventDetailsResponse,
  WebsiteGoalsResponse,
  WebsiteGoal,
  CreateGoalRequest,
  UpdateGoalRequest,
  WebsiteAlertsResponse,
  WebsiteAlert,
  ResolveAlertRequest,
} from "../client";

// Query keys
export const websiteAnalyticsKeys = {
  realtime: () => ["website-analytics", "realtime"] as const,
  overview: (params?: { start?: string; end?: string }) =>
    ["website-analytics", "overview", params] as const,
  overviewEnhanced: (params?: { start?: string; end?: string }) =>
    ["website-analytics", "overview-enhanced", params] as const,
  timeseries: (params?: { start?: string; end?: string; granularity?: string }) =>
    ["website-analytics", "timeseries", params] as const,
  pages: (params?: { start?: string; end?: string; limit?: number }) =>
    ["website-analytics", "pages", params] as const,
  referrers: (params?: { start?: string; end?: string; limit?: number }) =>
    ["website-analytics", "referrers", params] as const,
  devices: (params?: { start?: string; end?: string }) =>
    ["website-analytics", "devices", params] as const,
  locations: (params?: { start?: string; end?: string; limit?: number }) =>
    ["website-analytics", "locations", params] as const,
  events: (params?: { start?: string; end?: string; limit?: number }) =>
    ["website-analytics", "events", params] as const,
  eventDetails: (params?: { limit?: number; start?: string; end?: string }) =>
    ["website-analytics", "event-details", params] as const,
  goals: () => ["website-analytics", "goals"] as const,
  alerts: (params?: { is_resolved?: boolean; limit?: number; offset?: number }) =>
    ["website-analytics", "alerts", params] as const,
};

// =============================================================================
// Realtime Analytics
// =============================================================================

/** Get realtime visitor count and details */
export function useWebsiteRealtime(enabled = true) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.realtime(),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsRealtime();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteRealtimeResponse;
    },
    enabled,
    refetchInterval: 5000, // Refresh every 5 seconds for realtime feel
  });
}

// =============================================================================
// Overview Analytics
// =============================================================================

/** Get website analytics overview (basic) */
export function useWebsiteOverview(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.overview(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsOverview(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteOverviewResponse;
    },
    enabled,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

/** Get enhanced overview with period comparison */
export function useWebsiteOverviewEnhanced(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.overviewEnhanced(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsOverviewEnhanced(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteOverviewEnhancedResponse;
    },
    enabled,
    refetchInterval: 30000,
  });
}

// =============================================================================
// Timeseries Analytics
// =============================================================================

/** Get timeseries data for charts */
export function useWebsiteTimeseries(
  params?: { start?: string; end?: string; granularity?: string },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.timeseries(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsTimeseries(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteTimeseriesResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Pages Analytics
// =============================================================================

/** Get top pages */
export function useWebsiteTopPages(
  params?: { start?: string; end?: string; limit?: number },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.pages(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsPages(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteTopPagesResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Traffic Sources Analytics
// =============================================================================

/** Get traffic sources (referrers) */
export function useWebsiteReferrers(
  params?: { start?: string; end?: string; limit?: number },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.referrers(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsReferrers(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteReferrersResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Device Analytics
// =============================================================================

/** Get device breakdown */
export function useWebsiteDevices(
  params?: { start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.devices(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsDevices(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteDevicesResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Location Analytics
// =============================================================================

/** Get geographic breakdown */
export function useWebsiteLocations(
  params?: { start?: string; end?: string; limit?: number },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.locations(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsLocations(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteLocationsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Events Analytics
// =============================================================================

/** Get custom events summary */
export function useWebsiteEvents(
  params?: { start?: string; end?: string; limit?: number },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.events(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsEvents(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteEventsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

/** Get event details (individual events) */
export function useWebsiteEventDetails(
  params?: { limit?: number; start?: string; end?: string },
  enabled = true
) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.eventDetails(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsEventDetails(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteEventDetailsResponse;
    },
    enabled,
    refetchInterval: 60000,
  });
}

// =============================================================================
// Goals Analytics
// =============================================================================

/** Get all analytics goals */
export function useWebsiteGoals(enabled = true) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.goals(),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsGoals();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteGoalsResponse;
    },
    enabled,
    staleTime: 60000,
  });
}

/** Create a new analytics goal */
export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateGoalRequest) => {
      const response = await apiClient.createWebsiteAnalyticsGoal(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteGoal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteAnalyticsKeys.goals() });
    },
  });
}

/** Update an existing analytics goal */
export function useUpdateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, data }: { goalId: string; data: UpdateGoalRequest }) => {
      const response = await apiClient.updateWebsiteAnalyticsGoal(goalId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteGoal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteAnalyticsKeys.goals() });
    },
  });
}

/** Delete an analytics goal */
export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goalId: string) => {
      const response = await apiClient.deleteWebsiteAnalyticsGoal(goalId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteAnalyticsKeys.goals() });
    },
  });
}

// =============================================================================
// Alerts
// =============================================================================

/** Get website analytics alerts */
export function useWebsiteAlerts(params?: {
  is_resolved?: boolean;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: websiteAnalyticsKeys.alerts(params),
    queryFn: async () => {
      const response = await apiClient.getWebsiteAnalyticsAlerts(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WebsiteAlertsResponse;
    },
  });
}

/** Resolve an analytics alert */
export function useResolveAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      resolution_note,
    }: {
      alertId: string;
      resolution_note?: string;
    }) => {
      const response = await apiClient.resolveWebsiteAnalyticsAlert(alertId, {
        resolution_note,
      });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["website-analytics", "alerts"]
      });
    },
  });
}

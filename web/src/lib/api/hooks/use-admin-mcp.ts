import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../client";

// =============================================================================
// Types for MCP Proxy Logs
// =============================================================================

/** Status of an MCP proxy request */
export type McpProxyLogStatus = "success" | "error" | "timeout";

/** Individual MCP proxy log entry */
export interface McpProxyLogEntry {
  id: string;
  mcp_id: string;
  mcp_name: string;
  org_id: string;
  org_name: string;
  api_key_id: string | null;
  method: string;
  tool_name: string | null;
  resource_uri: string | null;
  status: McpProxyLogStatus;
  latency_ms: number | null;
  error_message: string | null;
  request_size_bytes: number | null;
  response_size_bytes: number | null;
  created_at: string;
}

/** Statistics for MCP proxy logs */
export interface McpProxyLogStats {
  total_requests: number;
  success_count: number;
  error_count: number;
  timeout_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
}

/** Paginated response for MCP proxy logs */
export interface McpProxyLogsResponse {
  logs: McpProxyLogEntry[];
  stats: McpProxyLogStats;
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

/** Filters for querying MCP proxy logs */
export interface McpProxyLogFilters {
  /** Filter by status (success, error, timeout) */
  status?: McpProxyLogStatus;
  /** Filter by method type */
  method?: string;
  /** Filter by MCP name (partial match) */
  mcp_name?: string;
  /** Filter by organization name (partial match) */
  org_name?: string;
  /** Search term for MCP name, tool name, or error message */
  search?: string;
  /** Date range filter */
  date_range?: "1h" | "24h" | "7d" | "30d" | "all";
  /** Custom start date (ISO 8601) */
  start?: string;
  /** Custom end date (ISO 8601) */
  end?: string;
  /** Page number */
  page?: number;
  /** Items per page */
  per_page?: number;
}

// =============================================================================
// Query Keys
// =============================================================================

export const adminMcpKeys = {
  logs: (filters?: McpProxyLogFilters) => ["admin", "mcp", "logs", filters] as const,
  methods: () => ["admin", "mcp", "methods"] as const,
};

// =============================================================================
// Hook: useAdminMcpLogs
// =============================================================================

/**
 * Fetch MCP proxy logs with filtering and pagination.
 * Auto-refreshes every 30 seconds by default.
 */
export function useAdminMcpLogs(
  filters?: McpProxyLogFilters,
  enabled = true
) {
  return useQuery({
    queryKey: adminMcpKeys.logs(filters),
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (filters?.status) searchParams.set("status", filters.status);
      if (filters?.method) searchParams.set("method", filters.method);
      if (filters?.mcp_name) searchParams.set("mcp_name", filters.mcp_name);
      if (filters?.org_name) searchParams.set("org_name", filters.org_name);
      if (filters?.search) searchParams.set("search", filters.search);
      if (filters?.date_range) searchParams.set("date_range", filters.date_range);
      if (filters?.start) searchParams.set("start", filters.start);
      if (filters?.end) searchParams.set("end", filters.end);
      if (filters?.page) searchParams.set("page", filters.page.toString());
      if (filters?.per_page) searchParams.set("per_page", filters.per_page.toString());

      const query = searchParams.toString();
      const endpoint = `/api/v1/admin/mcp/logs${query ? `?${query}` : ""}`;

      // Use the internal request method via a custom fetch
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}${endpoint}`,
        {
          headers: {
            "Content-Type": "application/json",
            ...(apiClient["accessToken"]
              ? { Authorization: `Bearer ${apiClient["accessToken"]}` }
              : {}),
          },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || errorData.message || `API error: ${response.status}`
        );
      }

      const data = await response.json();
      return data as McpProxyLogsResponse;
    },
    enabled,
    refetchInterval: enabled ? 30000 : false, // Auto-refresh every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
  });
}

// =============================================================================
// Hook: useAdminMcpMethods
// =============================================================================

/**
 * Fetch distinct MCP methods for dropdown filters.
 */
export function useAdminMcpMethods(enabled = true) {
  return useQuery({
    queryKey: adminMcpKeys.methods(),
    queryFn: async () => {
      const endpoint = `/api/v1/admin/mcp/methods`;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}${endpoint}`,
        {
          headers: {
            "Content-Type": "application/json",
            ...(apiClient["accessToken"]
              ? { Authorization: `Bearer ${apiClient["accessToken"]}` }
              : {}),
          },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || errorData.message || `API error: ${response.status}`
        );
      }

      const data = await response.json();
      return data.methods as string[];
    },
    enabled,
    staleTime: 60000, // Methods list is relatively stable
  });
}

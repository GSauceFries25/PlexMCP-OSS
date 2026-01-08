import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  type TestHistoryEntry,
  type ConfigValidationResponse,
  type BatchTestResponse,
} from "../client";
import { mcpKeys } from "./use-mcps";

// Query keys for connections/testing
export const connectionKeys = {
  all: (orgId: string) => ["organizations", orgId, "connections"] as const,
  testHistory: (orgId: string, mcpId: string) =>
    ["organizations", orgId, "connections", mcpId, "history"] as const,
  validation: (orgId: string, mcpId: string) =>
    ["organizations", orgId, "connections", mcpId, "validation"] as const,
};

// Get test history for an MCP
export function useTestHistory(organizationId: string, mcpId: string) {
  return useQuery({
    queryKey: connectionKeys.testHistory(organizationId, mcpId),
    queryFn: async () => {
      const response = await apiClient.getTestHistory(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TestHistoryEntry[];
    },
    enabled: !!organizationId && !!mcpId,
  });
}

// Validate MCP config
export function useValidateConfig(organizationId: string, mcpId: string) {
  return useQuery({
    queryKey: connectionKeys.validation(organizationId, mcpId),
    queryFn: async () => {
      const response = await apiClient.validateMCPConfig(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ConfigValidationResponse;
    },
    enabled: !!organizationId && !!mcpId,
  });
}

// Validate MCP config mutation (for manual refresh)
export function useValidateConfigMutation(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mcpId: string) => {
      const response = await apiClient.validateMCPConfig(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ConfigValidationResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.validation(organizationId, data.mcp_id),
      });
    },
  });
}

// Test all MCPs mutation
export function useTestAllMCPs(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.testAllMCPs(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as BatchTestResponse;
    },
    onSuccess: () => {
      // Invalidate all MCP queries to refresh status
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
      // Invalidate all connection queries
      queryClient.invalidateQueries({
        queryKey: connectionKeys.all(organizationId),
      });
    },
  });
}

// Run individual health check and refresh history
export function useRunHealthCheck(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mcpId: string) => {
      const response = await apiClient.testMCPConnection(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return { mcpId, result: response.data };
    },
    onSuccess: ({ mcpId }) => {
      // Refresh MCPs list to update health status
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
      // Refresh test history
      queryClient.invalidateQueries({
        queryKey: connectionKeys.testHistory(organizationId, mcpId),
      });
    },
  });
}

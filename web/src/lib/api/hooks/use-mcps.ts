import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type CreateMCPRequest, type UpdateMCPRequest, type MCPHealthCheckResponse } from "../client";
import type { MCP } from "@/types/database";

// Query keys
export const mcpKeys = {
  all: (orgId: string) => ["organizations", orgId, "mcps"] as const,
  detail: (orgId: string, mcpId: string) => ["organizations", orgId, "mcps", mcpId] as const,
};

// Get all MCPs for an organization
export function useMCPs(organizationId: string) {
  return useQuery({
    queryKey: mcpKeys.all(organizationId),
    queryFn: async () => {
      const response = await apiClient.getMCPs(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MCP[];
    },
    enabled: !!organizationId,
  });
}

// Get a single MCP
export function useMCP(organizationId: string, mcpId: string) {
  return useQuery({
    queryKey: mcpKeys.detail(organizationId, mcpId),
    queryFn: async () => {
      const response = await apiClient.getMCP(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MCP;
    },
    enabled: !!organizationId && !!mcpId,
  });
}

// Create MCP mutation
export function useCreateMCP(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMCPRequest) => {
      const response = await apiClient.createMCP(organizationId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MCP;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
    },
  });
}

// Update MCP mutation
export function useUpdateMCP(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mcpId, data }: { mcpId: string; data: UpdateMCPRequest }) => {
      const response = await apiClient.updateMCP(organizationId, mcpId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MCP;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
      queryClient.invalidateQueries({ queryKey: mcpKeys.detail(organizationId, data.id) });
    },
  });
}

// Delete MCP mutation
export function useDeleteMCP(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mcpId: string) => {
      const response = await apiClient.deleteMCP(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
    },
  });
}

// Test MCP connection mutation
export function useTestMCPConnection(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mcpId: string) => {
      const response = await apiClient.testMCPConnection(organizationId, mcpId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MCPHealthCheckResponse;
    },
    onSuccess: () => {
      // Refresh MCPs list to update health status
      queryClient.invalidateQueries({ queryKey: mcpKeys.all(organizationId) });
    },
  });
}

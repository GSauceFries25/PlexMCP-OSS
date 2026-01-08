import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type CreateApiKeyRequest, type CreateApiKeyResponse, type RotateApiKeyRequest, type RotateApiKeyResponse, type UpdateApiKeyRequest } from "../client";
import type { ApiKey } from "@/types/database";

// Query keys
export const apiKeyKeys = {
  all: (orgId: string) => ["organizations", orgId, "api-keys"] as const,
};

// Get all API keys for an organization
export function useApiKeys(organizationId: string) {
  return useQuery({
    queryKey: apiKeyKeys.all(organizationId),
    queryFn: async () => {
      const response = await apiClient.getApiKeys(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ApiKey[];
    },
    enabled: !!organizationId,
  });
}

// Create API key mutation
export function useCreateApiKey(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateApiKeyRequest) => {
      const response = await apiClient.createApiKey(organizationId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CreateApiKeyResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(organizationId) });
    },
  });
}

// Revoke API key mutation
export function useRevokeApiKey(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keyId: string) => {
      const response = await apiClient.revokeApiKey(organizationId, keyId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(organizationId) });
    },
  });
}

// Rotate API key mutation - rotates the key in place without creating a new one
export function useRotateApiKey(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ keyId, pin }: { keyId: string; pin?: string }) => {
      const response = await apiClient.rotateApiKey(organizationId, keyId, pin ? { pin } : undefined);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as RotateApiKeyResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(organizationId) });
    },
  });
}

// Update API key mutation - updates name, MCP access, etc.
export function useUpdateApiKey(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ keyId, data }: { keyId: string; data: UpdateApiKeyRequest }) => {
      const response = await apiClient.updateApiKey(organizationId, keyId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ApiKey;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(organizationId) });
    },
  });
}

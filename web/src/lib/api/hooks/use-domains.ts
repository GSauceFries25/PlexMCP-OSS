import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type CustomDomain, type VerifyDomainResponse } from "../client";

// Query keys
export const domainKeys = {
  all: ["domains"] as const,
  detail: (id: string) => ["domains", id] as const,
};

// Get all custom domains
// Pass enabled: false to disable the query until auth is ready
export function useDomains(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: domainKeys.all,
    queryFn: async () => {
      const response = await apiClient.getDomains();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CustomDomain[];
    },
    enabled: options?.enabled !== false,
    // Don't retry on 401 errors - just return empty array
    retry: (failureCount, error) => {
      if (error?.message?.includes("401") || error?.message?.includes("Unauthorized")) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

// Get a single domain
export function useDomain(id: string) {
  return useQuery({
    queryKey: domainKeys.detail(id),
    queryFn: async () => {
      const response = await apiClient.getDomain(id);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CustomDomain;
    },
    enabled: !!id,
  });
}

// Create domain mutation
export function useCreateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (domain: string) => {
      const response = await apiClient.createDomain(domain);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CustomDomain;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.all });
    },
  });
}

// Verify domain mutation - returns full verification result with per-record status
export function useVerifyDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (domainId: string) => {
      const response = await apiClient.verifyDomain(domainId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as VerifyDomainResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.all });
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(data.domain.id) });
    },
  });
}

// Delete domain mutation
export function useDeleteDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (domainId: string) => {
      const response = await apiClient.deleteDomain(domainId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.all });
    },
  });
}

// Toggle domain active state mutation
export function useToggleDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ domainId, isActive }: { domainId: string; isActive: boolean }) => {
      const response = await apiClient.toggleDomain(domainId, isActive);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CustomDomain;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.all });
    },
  });
}

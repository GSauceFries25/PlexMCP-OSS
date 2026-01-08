import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type CheckSubdomainResponse } from "../client";
import { organizationKeys } from "./use-organization";

// Query keys for subdomain operations
export const subdomainKeys = {
  check: (subdomain: string) => ["subdomain", "check", subdomain] as const,
};

// Check subdomain availability mutation
// Uses mutation instead of query because we want to control when checks happen (debounced)
export function useCheckSubdomain() {
  return useMutation({
    mutationFn: async (subdomain: string): Promise<CheckSubdomainResponse> => {
      const response = await apiClient.checkSubdomainAvailability(subdomain);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CheckSubdomainResponse;
    },
  });
}

// Update custom subdomain mutation
export function useUpdateCustomSubdomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      organizationId,
      customSubdomain,
    }: {
      organizationId: string;
      customSubdomain: string;
    }) => {
      const response = await apiClient.updateOrganization(organizationId, {
        custom_subdomain: customSubdomain,
      });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { organizationId }) => {
      // Invalidate organization queries to refresh data
      queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(organizationId),
      });
    },
  });
}

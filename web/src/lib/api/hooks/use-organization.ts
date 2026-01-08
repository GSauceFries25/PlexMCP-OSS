import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type CreateOrganizationRequest, type UpdateOrganizationRequest } from "../client";
import type { Organization } from "@/types/database";

// Query keys
export const organizationKeys = {
  all: ["organizations"] as const,
  detail: (id: string) => ["organizations", id] as const,
};

// Get all organizations for the current user
export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.all,
    queryFn: async () => {
      const response = await apiClient.getOrganizations();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as Organization[];
    },
  });
}

// Get a single organization
export function useOrganization(id: string) {
  return useQuery({
    queryKey: organizationKeys.detail(id),
    queryFn: async () => {
      const response = await apiClient.getOrganization(id);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as Organization;
    },
    enabled: !!id,
  });
}

// Create organization mutation
export function useCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateOrganizationRequest) => {
      const response = await apiClient.createOrganization(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as Organization;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

// Update organization mutation
export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateOrganizationRequest }) => {
      const response = await apiClient.updateOrganization(id, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as Organization;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(data.id) });
    },
  });
}

// Delete organization mutation
export function useDeleteOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.deleteOrganization(id);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

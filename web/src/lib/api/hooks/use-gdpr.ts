import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, GdprDataExport, GdprDeletionStatus, GdprDeletionResponse } from "../client";
import { useAuth } from "@/providers/auth-provider";

// Query keys for GDPR data
export const gdprKeys = {
  all: ["gdpr"] as const,
  export: () => [...gdprKeys.all, "export"] as const,
  deletionStatus: () => [...gdprKeys.all, "deletion-status"] as const,
};

/**
 * Hook to fetch GDPR data export
 * This is manually triggered, not auto-fetched
 */
export function useGdprExport() {
  const { user, accessToken } = useAuth();

  return useQuery({
    queryKey: gdprKeys.export(),
    queryFn: async () => {
      const response = await apiClient.gdprExportData();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as GdprDataExport;
    },
    // Manual trigger only - don't auto-fetch
    enabled: false,
    staleTime: 0, // Always refetch when triggered
  });
}

/**
 * Hook to check deletion request status
 */
export function useGdprDeletionStatus() {
  const { user, accessToken } = useAuth();

  return useQuery({
    queryKey: gdprKeys.deletionStatus(),
    queryFn: async () => {
      const response = await apiClient.gdprGetDeletionStatus();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as GdprDeletionStatus;
    },
    staleTime: 60 * 1000, // Consider fresh for 1 minute
    enabled: !!user && !!accessToken,
  });
}

/**
 * Hook to request account deletion
 */
export function useRequestDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ confirmEmail, reason }: { confirmEmail: string; reason?: string }) => {
      const response = await apiClient.gdprRequestDeletion(confirmEmail, reason);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as GdprDeletionResponse;
    },
    onSuccess: () => {
      // Invalidate deletion status to refetch
      queryClient.invalidateQueries({ queryKey: gdprKeys.deletionStatus() });
    },
  });
}

/**
 * Hook to cancel pending deletion request
 */
export function useCancelDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.gdprCancelDeletion();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate deletion status to refetch
      queryClient.invalidateQueries({ queryKey: gdprKeys.deletionStatus() });
    },
  });
}

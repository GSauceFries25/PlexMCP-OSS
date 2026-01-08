import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, NotificationPreferences, UpdateNotificationPreferencesRequest } from "../client";
import { useAuth } from "@/providers/auth-provider";

// Query keys for notification preferences
export const notificationKeys = {
  all: ["notifications"] as const,
  preferences: () => [...notificationKeys.all, "preferences"] as const,
};

/**
 * Hook to fetch current user's notification preferences
 */
export function useNotificationPreferences() {
  const { user, accessToken } = useAuth();

  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: async () => {
      const response = await apiClient.getNotificationPreferences();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as NotificationPreferences;
    },
    staleTime: 60 * 1000, // Consider fresh for 1 minute
    // Only fetch when user is authenticated and token is available
    enabled: !!user && !!accessToken,
  });
}

/**
 * Hook to update notification preferences
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateNotificationPreferencesRequest) => {
      const response = await apiClient.updateNotificationPreferences(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as NotificationPreferences;
    },
    onSuccess: (data) => {
      // Update the cached preferences
      queryClient.setQueryData(notificationKeys.preferences(), data);
    },
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type AddonsListResponse, type AddonInfo, type AddonQuantities, type EffectiveLimitsResponse, type EnableAddonResponse } from "../client";

// Query keys
export const addonKeys = {
  all: (orgId: string) => ["organizations", orgId, "addons"] as const,
  check: (orgId: string, addonType: string) => ["organizations", orgId, "addons", addonType] as const,
  quantities: (orgId: string) => ["organizations", orgId, "addons", "quantities"] as const,
  effectiveLimits: (orgId: string) => ["organizations", orgId, "effective-limits"] as const,
};

// Get all add-ons with their status for an organization
export function useAddons(organizationId: string) {
  return useQuery({
    queryKey: addonKeys.all(organizationId),
    queryFn: async () => {
      const response = await apiClient.getAddons(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AddonsListResponse;
    },
    enabled: !!organizationId,
  });
}

// Check if a specific add-on is enabled
export function useCheckAddon(organizationId: string, addonType: string) {
  return useQuery({
    queryKey: addonKeys.check(organizationId, addonType),
    queryFn: async () => {
      const response = await apiClient.checkAddon(organizationId, addonType);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as boolean;
    },
    enabled: !!organizationId && !!addonType,
  });
}

// Get add-on quantities for resource packs
export function useAddonQuantities(organizationId: string) {
  return useQuery({
    queryKey: addonKeys.quantities(organizationId),
    queryFn: async () => {
      const response = await apiClient.getAddonQuantities(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AddonQuantities;
    },
    enabled: !!organizationId,
  });
}

// Get effective limits (tier + add-on boosts)
export function useEffectiveLimits(organizationId: string) {
  return useQuery({
    queryKey: addonKeys.effectiveLimits(organizationId),
    queryFn: async () => {
      const response = await apiClient.getEffectiveLimits(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as EffectiveLimitsResponse;
    },
    enabled: !!organizationId,
  });
}

// Enable an add-on mutation (with optional quantity for stackable add-ons)
// Returns either success with AddonInfo or checkout_required with checkout URL
export function useEnableAddon(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ addonType, quantity }: { addonType: string; quantity?: number }) => {
      const response = await apiClient.enableAddon(organizationId, addonType, quantity);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as EnableAddonResponse;
    },
    onSuccess: (data) => {
      // Only invalidate queries if it was a successful enable, not a checkout redirect
      if (data.type === "success") {
        queryClient.invalidateQueries({ queryKey: addonKeys.all(organizationId) });
        queryClient.invalidateQueries({ queryKey: addonKeys.quantities(organizationId) });
        queryClient.invalidateQueries({ queryKey: addonKeys.effectiveLimits(organizationId) });
      }
    },
  });
}

// Update add-on quantity mutation (for stackable add-ons)
export function useUpdateAddonQuantity(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ addonType, quantity }: { addonType: string; quantity: number }) => {
      const response = await apiClient.updateAddonQuantity(organizationId, addonType, quantity);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AddonInfo;
    },
    onSuccess: () => {
      // Invalidate add-ons and effective limits queries
      queryClient.invalidateQueries({ queryKey: addonKeys.all(organizationId) });
      queryClient.invalidateQueries({ queryKey: addonKeys.quantities(organizationId) });
      queryClient.invalidateQueries({ queryKey: addonKeys.effectiveLimits(organizationId) });
    },
  });
}

// Disable an add-on mutation
export function useDisableAddon(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (addonType: string) => {
      const response = await apiClient.disableAddon(organizationId, addonType);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate add-ons and effective limits queries
      queryClient.invalidateQueries({ queryKey: addonKeys.all(organizationId) });
      queryClient.invalidateQueries({ queryKey: addonKeys.quantities(organizationId) });
      queryClient.invalidateQueries({ queryKey: addonKeys.effectiveLimits(organizationId) });
    },
  });
}

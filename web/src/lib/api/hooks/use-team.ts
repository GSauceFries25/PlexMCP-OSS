import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type InvitationResponse } from "../client";
import type { User } from "@/types/database";

// Query keys
export const teamKeys = {
  members: (orgId: string) => ["organizations", orgId, "members"] as const,
  invitations: (orgId: string) => ["organizations", orgId, "invitations"] as const,
};

// Member status for team member limit enforcement
export type MemberStatus = "active" | "suspended" | "pending";

// Member with role type
export interface TeamMember extends User {
  role: string;
  joined_at?: string;
  status?: MemberStatus; // Optional for backward compatibility until migration is deployed
}

// Get all team members for an organization
export function useTeamMembers(organizationId: string) {
  return useQuery({
    queryKey: teamKeys.members(organizationId),
    queryFn: async () => {
      const response = await apiClient.getMembers(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TeamMember[];
    },
    enabled: !!organizationId,
  });
}

// Invite member mutation
export function useInviteMember(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      const response = await apiClient.inviteMember(organizationId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.members(organizationId) });
    },
  });
}

// Remove member mutation
export function useRemoveMember(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.removeMember(organizationId, userId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.members(organizationId) });
    },
  });
}

// Update member role mutation
export function useUpdateMemberRole(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await apiClient.updateMemberRole(organizationId, userId, role);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.members(organizationId) });
    },
  });
}

// =============================================================================
// Invitation Hooks
// =============================================================================

// Get all pending invitations for an organization
export function useInvitations(organizationId: string) {
  return useQuery({
    queryKey: teamKeys.invitations(organizationId),
    queryFn: async () => {
      const response = await apiClient.listInvitations();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data?.invitations ?? [];
    },
    enabled: !!organizationId,
  });
}

// Create invitation mutation
export function useCreateInvitation(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      const response = await apiClient.createInvitation(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as InvitationResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.invitations(organizationId) });
    },
  });
}

// Resend invitation mutation
export function useResendInvitation(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await apiClient.resendInvitation(invitationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.invitations(organizationId) });
    },
  });
}

// Cancel invitation mutation
export function useCancelInvitation(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await apiClient.cancelInvitation(invitationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.invitations(organizationId) });
    },
  });
}

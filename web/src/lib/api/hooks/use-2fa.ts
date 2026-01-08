import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  type TwoFactorStatusResponse,
  type TwoFactorSetupResponse,
  type TwoFactorConfirmRequest,
  type TwoFactorConfirmResponse,
  type TwoFactorVerifyRequest,
  type TwoFactorVerifyResponse,
  type TwoFactorDisableRequest,
  type Login2FARequest,
  type AuthResponse,
} from "../client";

// Query keys
export const twoFactorKeys = {
  status: () => ["2fa", "status"] as const,
};

// Get 2FA status for current user
export function use2FAStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: twoFactorKeys.status(),
    queryFn: async () => {
      const response = await apiClient.get2FAStatus();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TwoFactorStatusResponse;
    },
    enabled: options?.enabled ?? true,
  });
}

// Begin 2FA setup mutation - returns QR code and secret
export function useBegin2FASetup() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.begin2FASetup();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TwoFactorSetupResponse;
    },
  });
}

// Confirm 2FA setup mutation - returns backup codes
export function useConfirm2FASetup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TwoFactorConfirmRequest) => {
      const response = await apiClient.confirm2FASetup(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TwoFactorConfirmResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() });
    },
  });
}

// Verify 2FA code mutation
export function useVerify2FA() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TwoFactorVerifyRequest) => {
      const response = await apiClient.verify2FA(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TwoFactorVerifyResponse;
    },
    onSuccess: () => {
      // Refresh status after verify attempt (updates failed attempts counter)
      queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() });
    },
  });
}

// Disable 2FA mutation
export function useDisable2FA() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TwoFactorDisableRequest) => {
      const response = await apiClient.disable2FA(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() });
    },
  });
}

// Regenerate backup codes mutation
export function useRegenerateBackupCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TwoFactorVerifyRequest) => {
      const response = await apiClient.regenerateBackupCodes(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TwoFactorConfirmResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() });
    },
  });
}

// Login with 2FA code mutation (used after initial login returns 2FA required)
export function useLogin2FA() {
  return useMutation({
    mutationFn: async (data: Login2FARequest) => {
      const response = await apiClient.login2FA(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AuthResponse;
    },
  });
}

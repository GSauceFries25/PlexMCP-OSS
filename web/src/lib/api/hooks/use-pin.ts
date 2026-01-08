import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  type PinStatusResponse,
  type SetPinRequest,
  type ChangePinRequest,
  type VerifyPinRequest,
  type VerifyPinResponse,
  type RevealKeyResponse,
  type ForgotPinRequest,
  type ResetPinRequest,
  type ResetPinResponse,
  type MessageResponse,
} from "../client";

// Query keys
export const pinKeys = {
  status: () => ["pin", "status"] as const,
};

// Get PIN status for current user
export function usePinStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: pinKeys.status(),
    queryFn: async () => {
      const response = await apiClient.getPinStatus();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as PinStatusResponse;
    },
    enabled: options?.enabled ?? true,
  });
}

// Set PIN mutation
export function useSetPin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SetPinRequest) => {
      const response = await apiClient.setPin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pinKeys.status() });
    },
  });
}

// Change PIN mutation
export function useChangePin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ChangePinRequest) => {
      const response = await apiClient.changePin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pinKeys.status() });
    },
  });
}

// Verify PIN mutation
export function useVerifyPin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: VerifyPinRequest) => {
      const response = await apiClient.verifyPin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as VerifyPinResponse;
    },
    onSuccess: () => {
      // Refresh status after verify attempt (updates failed attempts counter)
      queryClient.invalidateQueries({ queryKey: pinKeys.status() });
    },
  });
}

// Delete PIN mutation
export function useDeletePin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: VerifyPinRequest) => {
      const response = await apiClient.deletePin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pinKeys.status() });
    },
  });
}

// Reveal API key mutation (requires PIN verification)
export function useRevealApiKey() {
  return useMutation({
    mutationFn: async ({ keyId, pin }: { keyId: string; pin: string }) => {
      const response = await apiClient.revealApiKey(keyId, pin);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as RevealKeyResponse;
    },
  });
}

// Forgot PIN mutation (sends reset email)
export function useForgotPin() {
  return useMutation({
    mutationFn: async (data: ForgotPinRequest) => {
      const response = await apiClient.forgotPin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as MessageResponse;
    },
  });
}

// Reset PIN mutation (validates token and sets new PIN)
export function useResetPin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ResetPinRequest) => {
      const response = await apiClient.resetPin(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ResetPinResponse;
    },
    onSuccess: () => {
      // Refresh PIN status after successful reset
      queryClient.invalidateQueries({ queryKey: pinKeys.status() });
    },
  });
}

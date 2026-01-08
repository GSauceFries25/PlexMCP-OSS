import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  type SubscriptionInfo,
  type CreateCheckoutSessionRequest,
  type BillingUsageResponse,
  type OveragesResponse,
  type CurrentOverageResponse,
  type AccumulatedOverageResponse,
  type SpendCapStatusResponse,
  type SetSpendCapRequest,
  type InstantChargeResponse,
  type ScheduleDowngradeResponse,
  type ReactivationResponse,
  type ProrationPreview,
} from "../client";
import { getCsrfHeaders } from "@/lib/csrf-client";

// Types previously imported from billing components
export interface Invoice {
  id: string;
  stripe_invoice_id: string;
  organization_id: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  amount_remaining_cents: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  billing_reason: string;
  period_start: string;
  period_end: string;
  due_date: string | null;
  paid_at: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  total_amount_cents: number;
  period_start: string | null;
  period_end: string | null;
}

export interface PaymentAttempt {
  id: string;
  invoice_id: string;
  amount_cents: number;
  status: "succeeded" | "failed" | "pending" | "canceled";
  failure_reason: string | null;
  payment_method_type: string | null;
  attempted_at: string;
}

export interface InvoiceDetail extends Invoice {
  line_items: InvoiceLineItem[];
  payment_attempts: PaymentAttempt[];
  dispute?: {
    id: string;
    status: string;
    reason: string;
    description: string;
    created_at: string;
  };
}

export interface GracePeriodStatus {
  is_in_grace_period: boolean;
  is_paused: boolean;
  grace_period_ends_at: string | null;
  paused_at: string | null;
  outstanding_balance_cents: number;
  days_remaining: number | null;
}

// Query keys
export const billingKeys = {
  subscription: (orgId: string) => ["organizations", orgId, "subscription"] as const,
  billingUsage: (orgId: string) => ["organizations", orgId, "billing-usage"] as const,
  invoices: () => ["billing", "invoices"] as const,
  invoiceDetail: (invoiceId: string) => ["billing", "invoices", invoiceId] as const,
  gracePeriod: () => ["billing", "grace-period"] as const,
  overages: (orgId: string) => ["organizations", orgId, "overages"] as const,
  currentOverage: (orgId: string) => ["organizations", orgId, "overages", "current"] as const,
  accumulatedOverage: (orgId: string) => ["organizations", orgId, "overages", "accumulated"] as const,
  spendCap: (orgId: string) => ["organizations", orgId, "spend-cap"] as const,
  instantCharges: (orgId: string) => ["organizations", orgId, "instant-charges"] as const,
};

// Get subscription info for an organization
// Polls every 60 seconds to ensure entitlements stay in sync with tier changes
export function useSubscription(organizationId: string) {
  return useQuery({
    queryKey: billingKeys.subscription(organizationId),
    queryFn: async () => {
      const response = await apiClient.getSubscription(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SubscriptionInfo;
    },
    enabled: !!organizationId,
    staleTime: 30_000, // Consider data stale after 30 seconds
    refetchInterval: 60_000, // Poll every 60 seconds for tier changes
    refetchOnWindowFocus: true, // Refetch when user returns to tab
  });
}

// Create checkout session mutation
export function useCreateCheckoutSession(organizationId: string) {
  return useMutation({
    mutationFn: async (data: CreateCheckoutSessionRequest) => {
      const response = await apiClient.createCheckoutSession(organizationId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
  });
}

// Create billing portal session mutation
export function useCreatePortalSession(organizationId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!organizationId) {
        throw new Error("Organization ID is required");
      }
      const response = await apiClient.createPortalSession(organizationId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
  });
}

// Get billing period usage (requests used vs limit)
export function useBillingUsage(organizationId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.billingUsage(organizationId || ""),
    queryFn: async () => {
      const response = await apiClient.getBillingUsage(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as BillingUsageResponse;
    },
    enabled: !!organizationId,
  });
}

// Get invoices from Stripe (via Next.js API route)
export function useInvoices() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: billingKeys.invoices(),
    queryFn: async () => {
      const response = await fetch("/api/billing/invoices", {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error("Failed to fetch invoices");
      }
      const data = await response.json();
      return data.invoices as Invoice[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
  };

  return {
    ...query,
    refresh,
  };
}

// Get overage charges history
export function useOverages(organizationId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: billingKeys.overages(organizationId || ""),
    queryFn: async () => {
      const response = await apiClient.getOverages(organizationId!, limit);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as OveragesResponse;
    },
    enabled: !!organizationId,
  });
}

// Get current billing period overage (real-time)
export function useCurrentOverage(organizationId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.currentOverage(organizationId || ""),
    queryFn: async () => {
      const response = await apiClient.getCurrentOverage(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as CurrentOverageResponse;
    },
    enabled: !!organizationId,
    refetchInterval: 60000, // Refresh every minute for real-time updates
  });
}

// Cancel subscription (sets cancel_at_period_end = true)
export function useCancelSubscription(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.cancelSubscription(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SubscriptionInfo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
    },
  });
}

// Resume subscription (sets cancel_at_period_end = false)
export function useResumeSubscription(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.resumeSubscription(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SubscriptionInfo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
    },
  });
}

// Reactivate a cancelled subscription with proration credit
export function useReactivateSubscription(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { tier: string; billingInterval: string }) => {
      const response = await apiClient.reactivateSubscription(organizationId!, {
        tier: data.tier,
        billing_interval: data.billingInterval,
      });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ReactivationResponse;
    },
    onSuccess: () => {
      // Invalidate all billing-related queries
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.billingUsage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.overages(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.currentOverage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.accumulatedOverage(organizationId || "") });
    },
  });
}

// Update subscription tier (upgrade/downgrade with proration)
export function useUpdateSubscription(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: string) => {
      const response = await apiClient.updateSubscription(organizationId!, tier);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SubscriptionInfo;
    },
    onSuccess: () => {
      // Invalidate all billing-related queries
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.billingUsage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.overages(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.currentOverage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.accumulatedOverage(organizationId || "") });
    },
  });
}

// Preview proration for subscription upgrade
export function usePreviewProration(organizationId: string | undefined) {
  return useMutation({
    mutationFn: async (tier: string) => {
      const response = await apiClient.previewProration(organizationId!, tier);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ProrationPreview;
    },
  });
}

// ============================================================================
// Downgrade Scheduling Hooks
// ============================================================================

// Schedule a downgrade to take effect at period end
export function useScheduleDowngrade(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: string) => {
      const response = await apiClient.scheduleDowngrade(organizationId!, tier);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as ScheduleDowngradeResponse;
    },
    onSuccess: () => {
      // Invalidate subscription to show pending downgrade
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
    },
  });
}

// Cancel a scheduled downgrade
export function useCancelScheduledDowngrade(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.cancelScheduledDowngrade(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      // Invalidate subscription to clear pending downgrade
      queryClient.invalidateQueries({ queryKey: billingKeys.subscription(organizationId || "") });
    },
  });
}

// ============================================================================
// Spend Cap Hooks
// ============================================================================

// Get spend cap status
export function useSpendCap(organizationId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.spendCap(organizationId || ""),
    queryFn: async () => {
      const response = await apiClient.getSpendCap(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SpendCapStatusResponse;
    },
    enabled: !!organizationId,
  });
}

// Set/update spend cap
export function useSetSpendCap(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SetSpendCapRequest) => {
      const response = await apiClient.setSpendCap(organizationId!, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SpendCapStatusResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.spendCap(organizationId || "") });
    },
  });
}

// Remove spend cap
export function useRemoveSpendCap(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.removeSpendCap(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.spendCap(organizationId || "") });
    },
  });
}

// ============================================================================
// Pay Now Hooks
// ============================================================================

// Get accumulated overage (for pay-now display)
export function useAccumulatedOverage(organizationId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.accumulatedOverage(organizationId || ""),
    queryFn: async () => {
      const response = await apiClient.getAccumulatedOverage(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AccumulatedOverageResponse;
    },
    enabled: !!organizationId,
    refetchInterval: 60000, // Refresh every minute
  });
}

// Pay overages now
export function usePayOveragesNow(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.payOveragesNow(organizationId!);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: billingKeys.accumulatedOverage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.currentOverage(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.overages(organizationId || "") });
      queryClient.invalidateQueries({ queryKey: billingKeys.spendCap(organizationId || "") });
    },
  });
}

// ============================================================================
// Instant Charge Hooks
// ============================================================================

// Get instant charge history
export function useInstantCharges(organizationId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: [...billingKeys.instantCharges(organizationId || ""), limit],
    queryFn: async () => {
      const response = await apiClient.getInstantCharges(organizationId!, limit);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as InstantChargeResponse[];
    },
    enabled: !!organizationId,
  });
}

// ============================================================================
// Invoice Hooks (Database-backed)
// ============================================================================

interface InvoiceListResponse {
  invoices: Invoice[];
  total_count: number;
  outstanding_amount_cents: number;
  overdue_amount_cents: number;
}

// Get invoices from backend database
export function useInvoicesV2(status?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...billingKeys.invoices(), status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);

      const response = await fetch(`/api/billing/invoices?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error("Failed to fetch invoices");
      }
      return await response.json() as InvoiceListResponse;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
  };

  return {
    ...query,
    invoices: query.data?.invoices ?? [],
    totalCount: query.data?.total_count ?? 0,
    outstandingAmountCents: query.data?.outstanding_amount_cents ?? 0,
    overdueAmountCents: query.data?.overdue_amount_cents ?? 0,
    refresh,
  };
}

// Get invoice detail with line items and payment history
export function useInvoiceDetail(invoiceId: string | null) {
  return useQuery({
    queryKey: billingKeys.invoiceDetail(invoiceId || ""),
    queryFn: async () => {
      const response = await fetch(`/api/billing/invoices/${invoiceId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error("Failed to fetch invoice detail");
      }
      return await response.json() as InvoiceDetail;
    },
    enabled: !!invoiceId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Pay an outstanding invoice
export function usePayInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const csrfHeaders = await getCsrfHeaders();
      const response = await fetch(`/api/billing/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: {
          ...csrfHeaders,
        },
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to pay invoice");
      }
      return await response.json();
    },
    onSuccess: (_, invoiceId) => {
      // Invalidate all invoice-related queries
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      queryClient.invalidateQueries({ queryKey: billingKeys.invoiceDetail(invoiceId) });
      queryClient.invalidateQueries({ queryKey: billingKeys.gracePeriod() });
    },
  });
}

// Create an invoice dispute
export function useCreateInvoiceDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      invoiceId,
      reason,
      description,
    }: {
      invoiceId: string;
      reason: string;
      description: string;
    }) => {
      const csrfHeaders = await getCsrfHeaders();
      const response = await fetch(`/api/billing/invoices/${invoiceId}/dispute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders,
        },
        credentials: 'include',
        body: JSON.stringify({ reason, description }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create dispute");
      }
      return await response.json();
    },
    onSuccess: (_, { invoiceId }) => {
      // Invalidate invoice queries
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      queryClient.invalidateQueries({ queryKey: billingKeys.invoiceDetail(invoiceId) });
    },
  });
}

// Get grace period status
export function useGracePeriodStatus() {
  return useQuery({
    queryKey: billingKeys.gracePeriod(),
    queryFn: async () => {
      const response = await fetch("/api/billing/grace-period", {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error("Failed to fetch grace period status");
      }
      return await response.json() as GracePeriodStatus;
    },
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}

// Sync invoices from Stripe to local database
export function useSyncInvoices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const csrfHeaders = await getCsrfHeaders();
      const response = await fetch("/api/billing/invoices", {
        method: "POST",
        headers: {
          ...csrfHeaders,
        },
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to sync invoices");
      }
      return await response.json() as { synced_count: number; message: string };
    },
    onSuccess: () => {
      // Invalidate invoices query to refetch the synced data
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
    },
  });
}

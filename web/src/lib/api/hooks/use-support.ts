import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../client";
import { useAuth } from "@/providers/auth-provider";
import type {
  SupportTicketWithDetails,
  TicketWithMessages,
  FAQArticle,
  CreateTicketRequest,
  TicketStats,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  UpdateTicketRequest,
  EnhancedTicketStats,
  WorkloadResponse,
  SlaRule,
  CreateSlaRuleRequest,
  UpdateSlaRuleRequest,
  TicketTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  AssignmentHistoryEntry,
  BatchAssignRequest,
  BatchStatusRequest,
  BatchOperationResult,
  SupportTicketWithSla,
} from "@/types/support";

// Query keys
export const supportKeys = {
  tickets: (orgId: string) => ["support", "tickets", orgId] as const,
  ticket: (ticketId: string) => ["support", "ticket", ticketId] as const,
  faqs: (category?: string) => ["support", "faqs", category] as const,
  faqSearch: (query: string) => ["support", "faqs", "search", query] as const,
  adminTickets: (filters?: object) => ["admin", "support", "tickets", filters] as const,
  adminStats: () => ["admin", "support", "stats"] as const,
  adminStatsEnhanced: () => ["admin", "support", "stats", "enhanced"] as const,
  adminWorkload: () => ["admin", "support", "workload"] as const,
  adminSlaRules: () => ["admin", "support", "sla", "rules"] as const,
  adminTemplates: () => ["admin", "support", "templates"] as const,
  adminAssignmentHistory: (ticketId: string) => ["admin", "support", "tickets", ticketId, "history"] as const,
};

// =============================================================================
// User Ticket Hooks
// =============================================================================

// Get all tickets for the organization
export function useTickets(
  organizationId: string,
  params?: { status?: TicketStatus; limit?: number }
) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: [...supportKeys.tickets(organizationId), params],
    queryFn: async () => {
      const response = await apiClient.getTickets(organizationId, params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data || [];
    },
    enabled: !!organizationId && !!accessToken,
  });
}

// Get single ticket with messages
export function useTicket(ticketId: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: supportKeys.ticket(ticketId),
    queryFn: async () => {
      const response = await apiClient.getTicket(ticketId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TicketWithMessages;
    },
    enabled: !!ticketId && !!accessToken,
    // Prevent refetching stale/cached queries - only fetch on explicit invalidation
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes after becoming inactive
    staleTime: 0, // Data is immediately stale (will refetch on invalidation)
  });
}

// Create ticket mutation
export function useCreateTicket(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTicketRequest) => {
      const response = await apiClient.createTicket(organizationId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.tickets(organizationId) });
    },
  });
}

// Reply to ticket mutation
export function useReplyToTicket(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const response = await apiClient.replyToTicket(ticketId, { content });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      queryClient.invalidateQueries({ queryKey: supportKeys.tickets(organizationId) });
    },
  });
}

// Close ticket mutation
export function useCloseTicket(organizationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const response = await apiClient.closeTicket(ticketId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, ticketId) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      queryClient.invalidateQueries({ queryKey: supportKeys.tickets(organizationId) });
    },
  });
}

// =============================================================================
// FAQ Hooks
// =============================================================================

// Get all FAQs (optionally filtered by category)
// Disabled - FAQ endpoint not implemented, page uses static data instead
export function useFAQs(_category?: string) {
  return useQuery({
    queryKey: supportKeys.faqs(_category),
    queryFn: async () => undefined,
    enabled: false, // Disabled - using static FAQ data in help page
  });
}

// Search FAQs
// Disabled - FAQ search endpoint not implemented, client-side search would be used instead
export function useFAQSearch(_query: string) {
  return useQuery({
    queryKey: supportKeys.faqSearch(_query),
    queryFn: async () => [] as FAQArticle[],
    enabled: false, // Disabled - FAQ search endpoint not implemented
  });
}

// Submit FAQ feedback
export function useFAQFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ articleId, helpful }: { articleId: string; helpful: boolean }) => {
      const response = await apiClient.submitFAQFeedback(articleId, helpful);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      // Invalidate all FAQ queries to refresh counts
      queryClient.invalidateQueries({ queryKey: ["support", "faqs"] });
    },
  });
}

// =============================================================================
// Admin Ticket Hooks
// =============================================================================

// Get all tickets (admin)
export function useAdminTickets(
  params?: {
    status?: TicketStatus[];
    priority?: TicketPriority[];
    category?: TicketCategory[];
    search?: string;
    page?: number;
    per_page?: number;
  },
  enabled = true
) {
  return useQuery({
    queryKey: supportKeys.adminTickets(params),
    queryFn: async () => {
      const response = await apiClient.adminGetAllTickets(params);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as { tickets: SupportTicketWithDetails[]; total: number };
    },
    enabled,
  });
}

// Get ticket stats (admin)
export function useAdminTicketStats(enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminStats(),
    queryFn: async () => {
      const response = await apiClient.adminGetTicketStats();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TicketStats;
    },
    enabled,
  });
}

// Update ticket (admin)
export function useAdminUpdateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, data }: { ticketId: string; data: UpdateTicketRequest }) => {
      const response = await apiClient.adminUpdateTicket(ticketId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      // Invalidate all admin ticket queries (with any filter combination)
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support" &&
          query.queryKey[2] === "tickets"
      });
      queryClient.invalidateQueries({ queryKey: supportKeys.adminStats() });
      queryClient.invalidateQueries({ queryKey: supportKeys.adminStatsEnhanced() });
    },
  });
}

// Admin reply to ticket
export function useAdminReplyToTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const response = await apiClient.adminReplyToTicket(ticketId, content);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      // Invalidate all admin ticket queries (with any filter combination)
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support" &&
          query.queryKey[2] === "tickets"
      });
    },
  });
}

// Assign ticket (admin)
export function useAdminAssignTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, assignToUserId }: { ticketId: string; assignToUserId: string | null }) => {
      const response = await apiClient.adminAssignTicket(ticketId, assignToUserId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { ticketId }) => {
      // Invalidate the specific ticket
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      // Invalidate all admin ticket queries (with any filter combination)
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support" &&
          query.queryKey[2] === "tickets"
      });
      // Invalidate stats to update unassigned count
      queryClient.invalidateQueries({ queryKey: supportKeys.adminStats() });
      // Invalidate enhanced stats and workload
      queryClient.invalidateQueries({ queryKey: supportKeys.adminStatsEnhanced() });
      queryClient.invalidateQueries({ queryKey: supportKeys.adminWorkload() });
    },
  });
}

// =============================================================================
// Enhanced Admin Hooks (SLA, Workload, Templates, Batch)
// =============================================================================

// Get enhanced ticket stats with SLA metrics
export function useAdminTicketStatsEnhanced(enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminStatsEnhanced(),
    queryFn: async () => {
      const response = await apiClient.adminGetTicketStatsEnhanced();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as EnhancedTicketStats;
    },
    enabled,
    refetchInterval: 30000, // Refresh every 30 seconds for real-time feel
  });
}

// Get staff workload
export function useAdminWorkload(enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminWorkload(),
    queryFn: async () => {
      const response = await apiClient.adminGetWorkload();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as WorkloadResponse;
    },
    enabled,
  });
}

// Get assignment history for a ticket
export function useAdminAssignmentHistory(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminAssignmentHistory(ticketId),
    queryFn: async () => {
      const response = await apiClient.adminGetAssignmentHistory(ticketId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as AssignmentHistoryEntry[];
    },
    enabled: enabled && !!ticketId,
  });
}

// Reply with internal note option
export function useAdminReplyWithInternal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, content, isInternal }: { ticketId: string; content: string; isInternal: boolean }) => {
      const response = await apiClient.adminReplyWithInternal(ticketId, content, isInternal);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support" &&
          query.queryKey[2] === "tickets"
      });
    },
  });
}

// Batch assign tickets
export function useAdminBatchAssign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchAssignRequest) => {
      const response = await apiClient.adminBatchAssign(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as BatchOperationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support"
      });
    },
  });
}

// Batch update status
export function useAdminBatchStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchStatusRequest) => {
      const response = await apiClient.adminBatchStatus(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as BatchOperationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "admin" &&
          query.queryKey[1] === "support"
      });
    },
  });
}

// =============================================================================
// SLA Rules Hooks
// =============================================================================

export function useAdminSlaRules(enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminSlaRules(),
    queryFn: async () => {
      const response = await apiClient.adminGetSlaRules();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SlaRule[];
    },
    enabled,
  });
}

export function useAdminCreateSlaRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSlaRuleRequest) => {
      const response = await apiClient.adminCreateSlaRule(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SlaRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.adminSlaRules() });
    },
  });
}

export function useAdminUpdateSlaRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, data }: { ruleId: string; data: UpdateSlaRuleRequest }) => {
      const response = await apiClient.adminUpdateSlaRule(ruleId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as SlaRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.adminSlaRules() });
    },
  });
}

// =============================================================================
// Template Hooks
// =============================================================================

export function useAdminTemplates(enabled = true) {
  return useQuery({
    queryKey: supportKeys.adminTemplates(),
    queryFn: async () => {
      const response = await apiClient.adminGetTemplates();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TicketTemplate[];
    },
    enabled,
  });
}

export function useAdminCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTemplateRequest) => {
      const response = await apiClient.adminCreateTemplate(data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TicketTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.adminTemplates() });
    },
  });
}

export function useAdminUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, data }: { templateId: string; data: UpdateTemplateRequest }) => {
      const response = await apiClient.adminUpdateTemplate(templateId, data);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as TicketTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.adminTemplates() });
    },
  });
}

export function useAdminDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const response = await apiClient.adminDeleteTemplate(templateId);
      if (response.error) {
        throw new Error(response.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportKeys.adminTemplates() });
    },
  });
}

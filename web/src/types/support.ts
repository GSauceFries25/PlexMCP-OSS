// Support system types

export type TicketCategory =
  | "general"
  | "billing"
  | "technical"
  | "feature_request"
  | "bug_report"
  | "enterprise_inquiry";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "awaiting_response"
  | "resolved"
  | "closed";

export type TicketPriority =
  | "low"
  | "medium"
  | "high"
  | "urgent";

// Support ticket
export interface SupportTicket {
  id: string;
  ticket_number: string;
  organization_id: string;
  user_id: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

// Ticket with user and org info (for display)
export interface SupportTicketWithDetails extends SupportTicket {
  user_email?: string;
  user_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_company?: string;
  organization_name?: string;
  assigned_to_name?: string;
  assigned_to_email?: string;
  message_count?: number;
  last_message_at?: string;
}

// Ticket message
export interface TicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  is_admin_reply: boolean;
  content: string;
  created_at: string;
}

// Message with sender info
export interface TicketMessageWithSender extends TicketMessage {
  sender_name?: string;
  sender_email?: string;
  sender_avatar_url?: string;
}

// FAQ article
export interface FAQArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  search_keywords: string[];
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  is_published: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Create ticket request
export interface CreateTicketRequest {
  subject: string;
  category: TicketCategory;
  priority?: TicketPriority;
  content: string; // Initial message content
}

// Reply to ticket request
export interface ReplyToTicketRequest {
  content: string;
}

// Update ticket request (admin)
export interface UpdateTicketRequest {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_to?: string | null;
}

// Ticket with messages (full detail view)
export interface TicketWithMessages extends SupportTicketWithDetails {
  messages: TicketMessageWithSender[];
}

// Admin ticket view (includes messages for detail view)
export interface AdminTicketWithDetails extends SupportTicketWithDetails {
  messages?: TicketMessageWithSender[];
  assignee_name?: string;
}

// FAQ feedback request
export interface FAQFeedbackRequest {
  article_id: string;
  helpful: boolean;
}

// Ticket stats (for admin dashboard)
export interface TicketStats {
  total: number;
  open: number;
  in_progress: number;
  awaiting_response: number;
  resolved_today: number;
  avg_response_time_hours: number;
  urgent: number;
}

// Ticket filters (for admin list)
export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: TicketCategory[];
  assigned_to?: string;
  search?: string;
}

// Category labels for display
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  general: "General",
  billing: "Billing",
  technical: "Technical",
  feature_request: "Feature Request",
  bug_report: "Bug Report",
  enterprise_inquiry: "Enterprise Inquiry",
};

// Status labels for display
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  awaiting_response: "Awaiting Response",
  resolved: "Resolved",
  closed: "Closed",
};

// Priority labels for display
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// FAQ category labels
export const FAQ_CATEGORY_LABELS: Record<string, string> = {
  "getting-started": "Getting Started",
  "billing": "Billing & Subscriptions",
  "technical": "Technical",
  "troubleshooting": "Troubleshooting",
};

// =============================================================================
// SLA Types
// =============================================================================

export interface SlaRule {
  id: string;
  name: string;
  priority: TicketPriority;
  category: TicketCategory | null;
  first_response_hours: number;
  resolution_hours: number;
  business_hours_only: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSlaRuleRequest {
  name: string;
  priority: TicketPriority;
  category?: TicketCategory | null;
  first_response_hours: number;
  resolution_hours: number;
  business_hours_only?: boolean;
}

export interface UpdateSlaRuleRequest {
  name?: string;
  first_response_hours?: number;
  resolution_hours?: number;
  business_hours_only?: boolean;
  is_active?: boolean;
}

// =============================================================================
// Enhanced Ticket Types with SLA
// =============================================================================

export interface SupportTicketWithSla extends SupportTicketWithDetails {
  // SLA tracking fields
  first_response_at?: string | null;
  first_response_sla_hours?: number | null;
  resolution_sla_hours?: number | null;
  first_response_breached?: boolean;
  resolution_breached?: boolean;
  escalated_at?: string | null;
  original_priority?: TicketPriority | null;
}

// =============================================================================
// Workload Types
// =============================================================================

export type LoadStatus = "low" | "normal" | "high";

export interface StaffWorkload {
  user_id: string;
  email: string;
  name: string | null;
  assigned_tickets: number;
  open_tickets: number;
  urgent_tickets: number;
  avg_response_time_hours: number | null;
  load_status: LoadStatus;
}

export interface WorkloadResponse {
  staff: StaffWorkload[];
  unassigned_count: number;
}

// =============================================================================
// Template Types
// =============================================================================

export interface TicketTemplate {
  id: string;
  name: string;
  category: TicketCategory | null;
  content: string;
  shortcut: string | null;
  created_by: string | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  category?: TicketCategory | null;
  content: string;
  shortcut?: string | null;
}

export interface UpdateTemplateRequest {
  name?: string;
  category?: TicketCategory | null;
  content?: string;
  shortcut?: string | null;
  is_active?: boolean;
}

// =============================================================================
// Internal Notes & Enhanced Messages
// =============================================================================

export interface TicketMessageWithInternal extends TicketMessageWithSender {
  is_internal: boolean;
}

export interface ReplyWithInternalRequest {
  content: string;
  is_internal: boolean;
}

// =============================================================================
// Assignment History
// =============================================================================

export interface AssignmentHistoryEntry {
  id: string;
  ticket_id: string;
  assigned_from: string | null;
  assigned_from_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_by: string;
  assigned_by_name: string | null;
  reason: string | null;
  created_at: string;
}

// =============================================================================
// Batch Operations
// =============================================================================

export interface BatchAssignRequest {
  ticket_ids: string[];
  assigned_to: string | null;
  reason?: string;
}

export interface BatchStatusRequest {
  ticket_ids: string[];
  status: TicketStatus;
}

export interface BatchOperationResult {
  success_count: number;
  failed_count: number;
  errors: { ticket_id: string; error: string }[];
}

// =============================================================================
// Enhanced Stats with SLA
// =============================================================================

export interface EnhancedTicketStats {
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  awaiting_response_tickets: number;
  resolved_today: number;
  urgent_tickets: number;
  unassigned_tickets: number;
  avg_resolution_time_hours: number | null;
  // SLA metrics
  sla_at_risk: number;
  sla_breached: number;
  first_response_met_pct: number | null;
  resolution_met_pct: number | null;
}

// =============================================================================
// SLA Status Helpers
// =============================================================================

export type SlaStatus = "on_track" | "at_risk" | "breached";

export function calculateSlaStatus(
  createdAt: string,
  slaHours: number | null | undefined,
  completedAt?: string | null
): { status: SlaStatus; percentage: number } {
  if (!slaHours) {
    return { status: "on_track", percentage: 0 };
  }

  const start = new Date(createdAt).getTime();
  const deadline = start + slaHours * 60 * 60 * 1000;
  const now = completedAt ? new Date(completedAt).getTime() : Date.now();
  const elapsed = now - start;
  const total = deadline - start;
  const percentage = Math.min(100, Math.round((elapsed / total) * 100));

  if (percentage >= 100) {
    return { status: "breached", percentage };
  } else if (percentage >= 75) {
    return { status: "at_risk", percentage };
  }
  return { status: "on_track", percentage };
}

export function getSlaStatusColor(status: SlaStatus): string {
  switch (status) {
    case "breached":
      return "text-red-500";
    case "at_risk":
      return "text-yellow-500";
    default:
      return "text-green-500";
  }
}

export function getSlaProgressColor(status: SlaStatus): string {
  switch (status) {
    case "breached":
      return "bg-red-500";
    case "at_risk":
      return "bg-yellow-500";
    default:
      return "bg-green-500";
  }
}

// =============================================================================
// Email Webhook System Types (Day 4-5)
// =============================================================================

export type TicketSource = "web" | "email" | "api";

// Extended ticket interface with email fields
export interface SupportTicketWithEmail extends SupportTicketWithDetails {
  source?: TicketSource;
  original_email_from?: string | null;
  original_email_to?: string | null;
  email_thread_id?: string | null;
  has_attachments?: boolean;
}

// Staff email assignment
export interface StaffEmailAssignment {
  id: string;
  user_id: string;
  email_address: string;
  is_active: boolean;
  auto_generated: boolean;
  user_email: string;
  user_name: string;
  created_at: string;
  updated_at: string;
}

// Assign staff email request
export interface AssignStaffEmailRequest {
  user_id: string;
  email_address: string;
}

// Auto-generate staff email request
export interface AutoGenerateEmailRequest {
  user_id: string;
}

// Staff email assignment response
export interface StaffEmailResponse {
  success: boolean;
  assignment: StaffEmailAssignment;
}

// Remove staff email response
export interface RemoveStaffEmailResponse {
  success: boolean;
  message: string;
}

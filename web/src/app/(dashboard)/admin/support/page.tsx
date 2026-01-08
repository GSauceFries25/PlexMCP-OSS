"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { safeFormatDate, safeFormatDistanceToNow } from "@/lib/utils/date";

import {
  Search,
  Filter,
  ArrowRight,
  Send,
  Loader2,
  User,
  Shield,
  RefreshCw,
  UserPlus,
  CheckCircle,
  Clock,
  AlertCircle,
  MessageSquare,
  ShieldX,
  Lock,
  AlertTriangle,
  Users,
  X,
  ChevronDown,
  History,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignmentModal } from "@/components/admin/AssignmentModal";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useAdminTickets,
  useAdminTicketStatsEnhanced,
  useAdminUpdateTicket,
  useAdminReplyWithInternal,
  useAdminAssignTicket,
  useAdminWorkload,
  useAdminTemplates,
  useAdminBatchAssign,
  useAdminBatchStatus,
  useAdminAssignmentHistory,
  supportKeys,
} from "@/lib/api/hooks";
import { apiClient } from "@/lib/api/client";
import { useAuth } from "@/providers/auth-provider";
import { useWebSocket, useWebSocketEvent, usePresenceTracking, useUserPresence, useTicketSubscription } from "@/lib/websocket/hooks";
import {
  TICKET_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_CATEGORY_LABELS,
  calculateSlaStatus,
  getSlaProgressColor,
  type TicketStatus,
  type TicketPriority,
  type TicketCategory,
  type SlaStatus,
} from "@/types/support";
import type { AdminTicketWithDetails, TicketMessageWithSender, SupportTicketWithSla, TicketTemplate, StaffWorkload } from "@/types/support";

// Status badge colors
const STATUS_COLORS: Record<TicketStatus, string> = {
  open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_response: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  resolved: "bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900/30 dark:text-neutral-500",
};

// Priority badge colors
const PRIORITY_COLORS: Record<TicketPriority, string> = {
  low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// Load status colors for workload
const LOAD_STATUS_COLORS: Record<string, string> = {
  low: "bg-green-500",
  normal: "bg-blue-500",
  high: "bg-red-500",
};

// SLA Progress indicator component
function SlaProgressIndicator({
  label,
  createdAt,
  slaHours,
  completedAt,
  breached
}: {
  label: string;
  createdAt: string;
  slaHours: number | null | undefined;
  completedAt?: string | null;
  breached?: boolean;
}) {
  if (!slaHours) return null;

  const { status, percentage } = calculateSlaStatus(createdAt, slaHours, completedAt);
  const effectiveStatus = breached ? "breached" : status;

  // Static class map for Tailwind to properly detect classes
  const progressClasses = {
    breached: "h-1.5 [&>[data-slot=progress-indicator]]:bg-red-500",
    at_risk: "h-1.5 [&>[data-slot=progress-indicator]]:bg-yellow-500",
    on_track: "h-1.5 [&>[data-slot=progress-indicator]]:bg-green-500",
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className={breached ? "text-red-500" : status === "at_risk" ? "text-yellow-500" : "text-neutral-500"}>
          {breached ? "Breached" : `${percentage}%`}
        </span>
      </div>
      <Progress value={percentage} className={progressClasses[effectiveStatus]} />
    </div>
  );
}

// Enhanced message bubble with internal note support
function MessageBubble({ message, isInternal = false }: { message: TicketMessageWithSender; isInternal?: boolean }) {
  const isAdmin = message.is_admin_reply;

  return (
    <div className={`flex gap-3 ${isAdmin ? "" : "flex-row-reverse"}`}>
      <Avatar className="h-8 w-8 shrink-0">
        {message.sender_avatar_url ? (
          <AvatarImage src={message.sender_avatar_url} />
        ) : null}
        <AvatarFallback className={isAdmin ? "bg-blue-100 text-blue-600" : "bg-neutral-100 text-neutral-600"}>
          {isAdmin ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`flex-1 max-w-[80%] ${isAdmin ? "" : "text-right"}`}>
        <div className={`inline-block rounded-lg p-3 ${
          isInternal
            ? "bg-yellow-50 dark:bg-yellow-900/20 border-2 border-dashed border-yellow-300 dark:border-yellow-700 text-left"
            : isAdmin
            ? "bg-blue-50 dark:bg-blue-900/20 text-left"
            : "bg-neutral-100 dark:bg-neutral-800 text-left"
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {message.sender_name || (isAdmin ? "Support Team" : "Customer")}
            </span>
            {isAdmin && (
              <Badge variant="secondary" className="text-xs">
                Admin
              </Badge>
            )}
            {isInternal && (
              <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400">
                <Lock className="h-3 w-3 mr-1" />
                Internal
              </Badge>
            )}
          </div>
          <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          {safeFormatDate(message.created_at, "MMM d, yyyy 'at' h:mm a")}
        </p>
      </div>
    </div>
  );
}

// Ticket Detail Sheet (replaces Dialog for more space)
function TicketDetailSheet({
  ticket,
  open,
  onOpenChange,
  templates,
}: {
  ticket: (AdminTicketWithDetails & Partial<SupportTicketWithSla>) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates?: TicketTemplate[];
}) {
  const { user } = useAuth();
  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const updateTicket = useAdminUpdateTicket();
  const replyToTicket = useAdminReplyWithInternal();
  const assignTicket = useAdminAssignTicket();
  const { data: history } = useAdminAssignmentHistory(ticket?.id ?? "", open && !!ticket?.id);

  // Debug: Log ticket data when modal opens
  useEffect(() => {
    if (ticket && open) {
      console.log('[DEBUG] Ticket Data:', {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        user_id: ticket.user_id,
        user_email: ticket.user_email,
        user_name: ticket.user_name,
        organization_id: ticket.organization_id,
        organization_name: ticket.organization_name,
        subject: ticket.subject,
      });
    }
  }, [ticket, open]);

  // Real-time WebSocket features
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [viewers, setViewers] = useState<number>(0);

  // Track customer's online status
  const customerPresence = useUserPresence(ticket?.user_id || null);

  // Subscribe to this ticket's WebSocket room for real-time updates
  useTicketSubscription(ticket?.id || null);

  // Debug: Log subscription attempts
  useEffect(() => {
    if (ticket?.id) {
      console.log('[ADMIN WS DEBUG] Subscribing to ticket:', ticket.id);
    }
  }, [ticket?.id]);

  // Debug: Log presence data
  useEffect(() => {
    if (ticket?.user_id) {
      console.log('[DEBUG] Customer Presence for user', ticket.user_id, ':', customerPresence);
    }
  }, [ticket?.user_id, customerPresence]);

  // Listen for real-time updates from WebSocket
  useWebSocketEvent('new_message', (data: any) => {
    console.log('[ADMIN WS DEBUG] Received new_message event:', data);
    if (data.ticket_id === ticket?.id) {
      console.log('[ADMIN WS DEBUG] Ticket ID matches, calling refetchTicket()');
      refetchTicket();
    } else {
      console.log('[ADMIN WS DEBUG] Ticket ID mismatch. Expected:', ticket?.id, 'Got:', data.ticket_id);
    }
  }, [ticket?.id]); // ← CRITICAL FIX: Add ticket ID to dependencies

  useWebSocketEvent('ticket_updated', (data: any) => {
    console.log('[ADMIN WS DEBUG] Received ticket_updated event:', data);
    if (data.ticket_id === ticket?.id) {
      console.log('[ADMIN WS DEBUG] Ticket ID matches, calling refetchTicket()');
      refetchTicket();
    } else {
      console.log('[ADMIN WS DEBUG] Ticket ID mismatch. Expected:', ticket?.id, 'Got:', data.ticket_id);
    }
  }, [ticket?.id]); // ← CRITICAL FIX: Add ticket ID to dependencies

  useWebSocketEvent('user_typing_start', (data: any) => {
    if (data.ticket_id === ticket?.id) {
      setTypingUsers(prev => {
        if (!prev.includes(data.user_name)) {
          return [...prev, data.user_name];
        }
        return prev;
      });
    }
  }, [ticket?.id]); // ← CRITICAL FIX: Add ticket ID to dependencies

  useWebSocketEvent('user_typing_stop', (data: any) => {
    if (data.ticket_id === ticket?.id) {
      setTypingUsers(prev => prev.filter(name => name !== data.user_name));
    }
  }, [ticket?.id]); // ← CRITICAL FIX: Add ticket ID to dependencies

  useWebSocketEvent('viewers_update', (data: any) => {
    if (data.ticket_id === ticket?.id) {
      setViewers(data.viewers?.length || 0);
    }
  }, [ticket?.id]); // ← CRITICAL FIX: Add ticket ID to dependencies

  // Validate UUID format (36 characters: 8-4-4-4-12)
  const isValidUuid = (id: string | undefined): boolean => {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  };

  // Manual query control - only fetch when sheet is open AND we have a valid ticket ID
  // This prevents stale cached queries from executing
  const ticketId = open && ticket?.id && isValidUuid(ticket.id) ? ticket.id : null;

  console.log('[TicketDetailSheet] Query setup:', {
    open,
    ticketProp: ticket?.id,
    isValid: ticket?.id ? isValidUuid(ticket.id) : false,
    ticketId,
    willExecute: !!ticketId && open
  });

  const { data: ticketWithMessages, refetch: refetchTicket } = useQuery({
    queryKey: supportKeys.ticket(ticketId || ""), // Use standard key for proper invalidation
    queryFn: async () => {
      console.log('[TicketDetailSheet] Query executing for ticketId:', ticketId);
      if (!ticketId) return null;
      const response = await apiClient.adminGetTicket(ticketId);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    enabled: !!ticketId && open, // Double-check: only execute if we have a valid ID AND sheet is open
    staleTime: 0,
    gcTime: 0, // Don't cache at all - always fetch fresh
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Reset state when ticket changes
  useEffect(() => {
    if (!open) {
      setReplyContent("");
      setIsInternal(false);
      setShowHistory(false);
    }
  }, [open]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (ticketWithMessages?.messages && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ticketWithMessages?.messages]);

  if (!ticket) return null;

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim()) {
      toast.error("Please enter a message");
      return;
    }

    try {
      console.log('[ADMIN WS DEBUG] Sending reply to ticket:', ticket.id);
      await replyToTicket.mutateAsync({
        ticketId: ticket.id,
        content: replyContent.trim(),
        isInternal,
      });
      setReplyContent("");
      setIsInternal(false);
      toast.success(isInternal ? "Internal note added!" : "Reply sent!");

      // Refetch the ticket to show the new message immediately
      console.log('[ADMIN WS DEBUG] Reply sent successfully, calling refetchTicket()');
      await refetchTicket();
      console.log('[ADMIN WS DEBUG] refetchTicket() completed');
    } catch (error) {
      console.error('[ADMIN WS DEBUG] Error sending reply:', error);
      toast.error(error instanceof Error ? error.message : "Failed to send reply");
    }
  };

  const handleStatusChange = async (status: TicketStatus) => {
    try {
      await updateTicket.mutateAsync({
        ticketId: ticket.id,
        data: { status },
      });
      toast.success(`Status updated to ${TICKET_STATUS_LABELS[status]}`);

      // Refetch the ticket to show the updated status immediately
      await refetchTicket();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    }
  };

  const handleTemplateSelect = (template: TicketTemplate) => {
    setReplyContent(template.content);
    toast.success(`Template "${template.name}" loaded`);
  };

  // Use refetched data when available to show updates immediately
  const currentTicket = ticketWithMessages || ticket;

  const isClosed = currentTicket.status === "closed" || currentTicket.status === "resolved";

  // Calculate SLA status
  const firstResponseSla = calculateSlaStatus(
    ticket.created_at,
    ticket.first_response_sla_hours,
    ticket.first_response_at
  );
  const resolutionSla = calculateSlaStatus(
    ticket.created_at,
    ticket.resolution_sla_hours,
    ticket.resolved_at
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono text-neutral-500">
              {currentTicket.ticket_number}
            </span>
            <Badge variant="secondary" className={STATUS_COLORS[currentTicket.status]}>
              {TICKET_STATUS_LABELS[currentTicket.status]}
            </Badge>
            <Badge variant="secondary" className={PRIORITY_COLORS[currentTicket.priority]}>
              {TICKET_PRIORITY_LABELS[currentTicket.priority]}
            </Badge>
            {(ticket.first_response_breached || ticket.resolution_breached) && (
              <Badge variant="destructive" className="animate-pulse">
                <AlertTriangle className="h-3 w-3 mr-1" />
                SLA Breached
              </Badge>
            )}
          </div>
          <SheetTitle className="text-xl">{currentTicket.subject}</SheetTitle>
          <SheetDescription className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-2 flex-wrap">
              <span>
                <strong>From:</strong> {currentTicket.user_email || currentTicket.contact_email || "Unknown"}
              </span>
              {currentTicket.user_id && customerPresence && (
                <Badge variant="outline" className={
                  customerPresence.online_status === 'online'
                    ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                    : customerPresence.online_status === 'away'
                    ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400"
                    : "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400"
                }>
                  <div className={`h-2 w-2 rounded-full mr-1.5 ${
                    customerPresence.online_status === 'online' ? 'bg-green-500' :
                    customerPresence.online_status === 'away' ? 'bg-yellow-500' :
                    'bg-gray-500'
                  }`} />
                  {customerPresence.online_status === 'online' ? 'Online' :
                   customerPresence.online_status === 'away' ? 'Away' :
                   'Offline'}
                </Badge>
              )}
              <span>&bull; <strong>Category:</strong> {TICKET_CATEGORY_LABELS[currentTicket.category]}</span>
            </span>
            {(currentTicket as any).source === "email" && (
              <div className="border-t pt-2 mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">Via Email</Badge>
                </div>
                {(currentTicket as any).original_email_from && (
                  <span className="text-xs">
                    <strong>From:</strong> {(currentTicket as any).original_email_from}
                  </span>
                )}
                {(currentTicket as any).original_email_to && (
                  <span className="text-xs block">
                    <strong>To:</strong> {(currentTicket as any).original_email_to}
                  </span>
                )}
                {(currentTicket as any).email_thread_id && (
                  <span className="text-xs text-neutral-400 font-mono block">
                    Thread: {(currentTicket as any).email_thread_id}
                  </span>
                )}
              </div>
            )}
            <span>
              <strong>Created:</strong> {safeFormatDistanceToNow(currentTicket.created_at)}
            </span>
          </SheetDescription>
        </SheetHeader>

        {/* SLA Progress */}
        {(ticket.first_response_sla_hours || ticket.resolution_sla_hours) && (
          <div className="grid grid-cols-2 gap-4 py-3 border-b">
            <SlaProgressIndicator
              label="First Response"
              createdAt={ticket.created_at}
              slaHours={ticket.first_response_sla_hours}
              completedAt={ticket.first_response_at}
              breached={ticket.first_response_breached}
            />
            <SlaProgressIndicator
              label="Resolution"
              createdAt={ticket.created_at}
              slaHours={ticket.resolution_sla_hours}
              completedAt={ticket.resolved_at}
              breached={ticket.resolution_breached}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4 py-3 border-b flex-wrap">
          <Select
            value={currentTicket.status}
            onValueChange={(v) => handleStatusChange(v as TicketStatus)}
            disabled={updateTicket.isPending}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Change status" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setAssignmentModalOpen(true)}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {currentTicket.assigned_to ? "Reassign" : "Assign"}
          </Button>

          {currentTicket.assigned_to && (
            <span className="text-sm text-neutral-500">
              Assigned to: {currentTicket.assigned_to_email || "Admin"}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </div>

        {/* Assignment Modal */}
        <AssignmentModal
          ticketId={ticket.id}
          currentAssignee={
            ticket.assigned_to
              ? {
                  id: ticket.assigned_to,
                  email: ticket.assigned_to_email || "",
                  name: ticket.assigned_to_name,
                }
              : null
          }
          open={assignmentModalOpen}
          onOpenChange={setAssignmentModalOpen}
          onAssigned={() => refetchTicket()}
        />

        {/* Assignment History (Collapsible) */}
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleContent className="border-b">
            <div className="py-3 space-y-2 max-h-32 overflow-y-auto">
              <h4 className="text-xs font-medium text-neutral-500 uppercase">Assignment History</h4>
              {history && history.length > 0 ? (
                history.map((entry) => (
                  <div key={entry.id} className="text-xs text-neutral-600 dark:text-neutral-400">
                    <span className="font-medium">{entry.assigned_by_name || "System"}</span>
                    {" assigned to "}
                    <span className="font-medium">{entry.assigned_to_name || "Unassigned"}</span>
                    {entry.reason && <span className="text-neutral-500"> - {entry.reason}</span>}
                    <span className="text-neutral-400 ml-2">
                      {safeFormatDistanceToNow(entry.created_at)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-neutral-500">No assignment history</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {ticketWithMessages?.messages && ticketWithMessages.messages.length > 0 ? (
            <>
              {ticketWithMessages.messages.map((message, index) => (
                <div key={message.id}>
                  <MessageBubble
                    message={message}
                    isInternal={(message as any).is_internal === true}
                  />
                  {index < (ticketWithMessages.messages?.length ?? 0) - 1 && (
                    <Separator className="my-4" />
                  )}
                </div>
              ))}
              {/* Invisible div to scroll to */}
              <div ref={messagesEndRef} />
            </>
          ) : (
            <p className="text-center text-neutral-500 py-8">
              No messages yet
            </p>
          )}
        </div>

        {/* Reply Form */}
        {!isClosed && (
          <form onSubmit={handleReply} className="space-y-3 border-t pt-4">
            {/* Template Selector */}
            {templates && templates.length > 0 && (
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" type="button">
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Insert Template
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {templates.filter(t => t.is_active).map((template) => (
                      <DropdownMenuItem
                        key={template.id}
                        onClick={() => handleTemplateSelect(template)}
                      >
                        {template.name}
                        {template.shortcut && (
                          <span className="ml-auto text-xs text-neutral-500">/{template.shortcut}</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Viewer and Typing Indicators */}
            <div className="flex items-center gap-4 text-sm">
              {viewers > 0 && (
                <div className="flex items-center gap-2 text-neutral-500">
                  <Users className="h-4 w-4" />
                  <span>{viewers} {viewers === 1 ? 'viewer' : 'viewers'}</span>
                </div>
              )}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2 text-neutral-500 italic">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
                </div>
              )}
            </div>

            <Textarea
              placeholder={isInternal ? "Add internal note (not visible to customer)..." : "Type your reply..."}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              onKeyDown={(e) => {
                // Submit on Enter, allow Shift+Enter for new lines
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleReply(e as any);
                }
              }}
              rows={3}
              className={isInternal ? "border-yellow-300 focus:border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10" : ""}
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="internal-note"
                  checked={isInternal}
                  onCheckedChange={setIsInternal}
                />
                <Label htmlFor="internal-note" className="text-sm cursor-pointer flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Internal Note
                </Label>
              </div>

              <Button type="submit" disabled={replyToTicket.isPending}>
                {replyToTicket.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {isInternal ? "Add Note" : "Send Reply"}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Workload Card Component
function WorkloadCard({ staff, presenceStatus }: { staff: StaffWorkload; presenceStatus?: { online_status: 'online' | 'away' | 'offline'; last_activity_at: string } | null }) {
  const loadPercent = Math.min(100, (staff.assigned_tickets / 10) * 100); // Assuming 10 is high load

  // Static class map for Tailwind to properly detect classes
  const loadProgressClasses: Record<string, string> = {
    low: "h-1.5 [&>[data-slot=progress-indicator]]:bg-green-500",
    normal: "h-1.5 [&>[data-slot=progress-indicator]]:bg-blue-500",
    high: "h-1.5 [&>[data-slot=progress-indicator]]:bg-red-500",
  };

  // Presence indicator colors
  const presenceColors = {
    online: "bg-green-500",
    away: "bg-yellow-500",
    offline: "bg-neutral-400",
  };

  const presenceLabels = {
    online: "Online",
    away: "Away",
    offline: "Offline",
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-neutral-100 text-neutral-600">
                {staff.name?.[0] || staff.email[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {presenceStatus && (
              <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${presenceColors[presenceStatus.online_status]}`} title={presenceLabels[presenceStatus.online_status]} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{staff.name || staff.email}</p>
              {presenceStatus && presenceStatus.online_status === 'online' && (
                <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400">
                  Online
                </Badge>
              )}
            </div>
            <p className="text-xs text-neutral-500 truncate">{staff.email}</p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">Assigned</span>
            <span className="font-medium">{staff.assigned_tickets}</span>
          </div>
          <Progress value={loadPercent} className={loadProgressClasses[staff.load_status] || loadProgressClasses.normal} />
          <div className="flex justify-between text-xs text-neutral-500">
            <span>{staff.open_tickets} open</span>
            {staff.urgent_tickets > 0 && (
              <span className="text-red-500">{staff.urgent_tickets} urgent</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Floating Batch Action Bar
function BatchActionBar({
  selectedCount,
  onClear,
  onBatchAssign,
  onBatchStatus,
  isLoading,
}: {
  selectedCount: number;
  onClear: () => void;
  onBatchAssign: (userId: string | null) => void;
  onBatchStatus: (status: TicketStatus) => void;
  isLoading: boolean;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-xl px-4 py-3 flex items-center gap-4">
      <span className="text-sm font-medium">
        {selectedCount} ticket{selectedCount !== 1 ? "s" : ""} selected
      </span>

      <Separator orientation="vertical" className="h-6 bg-neutral-700 dark:bg-neutral-300" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200" disabled={isLoading}>
            <ChevronDown className="h-4 w-4 mr-2" />
            Change Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
            <DropdownMenuItem key={value} onClick={() => onBatchStatus(value as TicketStatus)}>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="sm"
        className="text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
        onClick={() => onBatchAssign(null)}
        disabled={isLoading}
      >
        Unassign
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
        onClick={onClear}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function AdminSupportPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  // WebSocket connection for real-time updates
  const token = typeof window !== "undefined" ? localStorage.getItem("plexmcp_access_token") : null;
  const { status: wsStatus, setPresence } = useWebSocket(token || undefined);

  // Debug: Log WebSocket status changes
  useEffect(() => {
    console.log('[AdminSupportPage] WebSocket status:', wsStatus);
  }, [wsStatus]);

  // Track online/offline status of staff members
  const presenceMap = usePresenceTracking();

  // Manual presence status control
  const [myPresenceStatus, setMyPresenceStatus] = useState<'online' | 'away' | 'offline'>('online');

  // Send presence update to backend when status changes
  const handlePresenceChange = (newStatus: 'online' | 'away' | 'offline') => {
    setMyPresenceStatus(newStatus);
    setPresence(newStatus);
    console.log('[AdminSupportPage] Changing presence status to:', newStatus);
  };

  // Listen for real-time ticket updates
  useWebSocketEvent("new_message", () => {
    queryClient.invalidateQueries({ queryKey: supportKeys.adminTickets() });
    queryClient.invalidateQueries({ queryKey: supportKeys.adminStats() });
  });

  useWebSocketEvent("ticket_updated", () => {
    queryClient.invalidateQueries({ queryKey: supportKeys.adminTickets() });
    queryClient.invalidateQueries({ queryKey: supportKeys.adminStats() });
    queryClient.invalidateQueries({ queryKey: supportKeys.adminWorkload() });
  });

  const [activeTab, setActiveTab] = useState("tickets");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<(AdminTicketWithDetails & Partial<SupportTicketWithSla>) | null>(null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());

  // Check if user is an admin
  const isAdmin = useMemo(() => {
    if (typeof window !== "undefined") {
      try {
        const customUser = localStorage.getItem("plexmcp_user");
        if (customUser) {
          const parsed = JSON.parse(customUser);
          return ["admin", "superadmin", "staff"].includes(parsed.platform_role || parsed.role);
        }
      } catch {
        // Ignore parse errors
      }
    }
    return ["admin", "superadmin", "staff"].includes((user as any)?.platform_role);
  }, [user]);

  // Clear stale ticket queries on page mount to prevent 404 errors
  useEffect(() => {
    const allQueries = queryClient.getQueryCache().getAll();
    console.log('[AdminSupportPage] All cached queries before clear:', allQueries.map(q => ({ key: q.queryKey, state: q.state.status })));

    queryClient.removeQueries({
      predicate: (query) => {
        const shouldRemove = query.queryKey[0] === "support" &&
          query.queryKey[1] === "ticket" &&
          typeof query.queryKey[2] === "string" &&
          query.queryKey[2].length > 0;
        if (shouldRemove) {
          console.log('[AdminSupportPage] Removing stale query:', query.queryKey);
        }
        return shouldRemove;
      },
    });

    console.log('[AdminSupportPage] Cache cleared');
  }, [queryClient]);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast.error("Access denied. Admin privileges required.");
      router.push("/");
    }
  }, [authLoading, isAdmin, router]);

  const filters = {
    ...(statusFilter !== "all" && { status: [statusFilter] }),
    ...(priorityFilter !== "all" && { priority: [priorityFilter] }),
    ...(categoryFilter !== "all" && { category: [categoryFilter] }),
  };

  const shouldFetch = !authLoading && isAdmin;

  const { data: tickets, isLoading: ticketsLoading, error: ticketsError, refetch } = useAdminTickets(
    Object.keys(filters).length > 0 ? filters : undefined,
    shouldFetch
  );
  const { data: stats, isLoading: statsLoading, error: statsError } = useAdminTicketStatsEnhanced(shouldFetch);
  const { data: workload } = useAdminWorkload(shouldFetch);
  const { data: templates } = useAdminTemplates(shouldFetch);

  const batchAssign = useAdminBatchAssign();
  const batchStatus = useAdminBatchStatus();

  // Support settings state
  const [showOnlineStatusToCustomers, setShowOnlineStatusToCustomers] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Filter by search query
  const ticketsList: (AdminTicketWithDetails & Partial<SupportTicketWithSla>)[] = Array.isArray(tickets) ? tickets : tickets?.tickets ?? [];
  const filteredTickets = ticketsList.filter((ticket) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ticket.subject.toLowerCase().includes(query) ||
      ticket.ticket_number.toLowerCase().includes(query) ||
      ticket.user_email?.toLowerCase().includes(query)
    );
  });

  // Selection handlers
  const toggleSelectTicket = (ticketId: string) => {
    setSelectedTicketIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ticketId)) {
        newSet.delete(ticketId);
      } else {
        newSet.add(ticketId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTicketIds.size === filteredTickets.length) {
      setSelectedTicketIds(new Set());
    } else {
      setSelectedTicketIds(new Set(filteredTickets.map(t => t.id)));
    }
  };

  const clearSelection = () => setSelectedTicketIds(new Set());

  const handleBatchAssign = async (userId: string | null) => {
    try {
      await batchAssign.mutateAsync({
        ticket_ids: Array.from(selectedTicketIds),
        assigned_to: userId,
      });
      toast.success(`${selectedTicketIds.size} tickets updated`);
      clearSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tickets");
    }
  };

  const handleBatchStatus = async (status: TicketStatus) => {
    try {
      await batchStatus.mutateAsync({
        ticket_ids: Array.from(selectedTicketIds),
        status,
      });
      toast.success(`${selectedTicketIds.size} tickets updated to ${TICKET_STATUS_LABELS[status]}`);
      clearSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tickets");
    }
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <ShieldX className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-neutral-500 dark:text-neutral-400">
          You don&apos;t have permission to access this page.
        </p>
        <Button onClick={() => router.push("/")}>
          Return to Dashboard
        </Button>
      </div>
    );
  }

  // Show error state if API calls failed
  if (ticketsError || statsError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load Support Data</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          {(ticketsError as Error)?.message || (statsError as Error)?.message || "An error occurred while loading support data. Please try again."}
        </p>
        <Button onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Support Tickets
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Manage customer support requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* My Presence Status Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <div className={`h-2 w-2 rounded-full mr-2 ${
                  myPresenceStatus === 'online' ? 'bg-green-500' :
                  myPresenceStatus === 'away' ? 'bg-yellow-500' :
                  'bg-gray-500'
                }`} />
                {myPresenceStatus === 'online' ? 'Online' :
                 myPresenceStatus === 'away' ? 'Away' :
                 'Offline'}
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set Your Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handlePresenceChange('online')}>
                <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
                Online
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresenceChange('away')}>
                <div className="h-2 w-2 rounded-full bg-yellow-500 mr-2" />
                Away
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresenceChange('offline')}>
                <div className="h-2 w-2 rounded-full bg-gray-500 mr-2" />
                Offline
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Enhanced Stats Cards */}
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-green-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Open</div>
              </div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats?.open_tickets || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">In Progress</div>
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats?.in_progress_tickets || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">At Risk</div>
              </div>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {stats?.sla_at_risk || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Breached</div>
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stats?.sla_breached || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-neutral-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Unassigned</div>
              </div>
              <div className="text-2xl font-bold text-neutral-600 dark:text-neutral-400">
                {stats?.unassigned_tickets || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Urgent</div>
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stats?.urgent_tickets || 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs for Tickets/Workload */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tickets">
            <MessageSquare className="h-4 w-4 mr-2" />
            Tickets
          </TabsTrigger>
          <TabsTrigger value="workload">
            <Users className="h-4 w-4 mr-2" />
            Workload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                placeholder="Search tickets..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TicketStatus | "all")}>
              <SelectTrigger className="w-[150px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as TicketPriority | "all")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as TicketCategory | "all")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tickets Table */}
          {ticketsLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredTickets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MessageSquare className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  No tickets found
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {searchQuery || statusFilter !== "all" || priorityFilter !== "all" || categoryFilter !== "all"
                    ? "Try adjusting your filters"
                    : "No support tickets yet"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedTicketIds.size === filteredTickets.length && filteredTickets.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map((ticket) => {
                    const slaStatus = calculateSlaStatus(
                      ticket.created_at,
                      ticket.resolution_sla_hours,
                      ticket.resolved_at
                    );
                    const isBreached = ticket.first_response_breached || ticket.resolution_breached;

                    return (
                      <TableRow
                        key={ticket.id}
                        className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button, [role="checkbox"]')) return;
                          setSelectedTicket(ticket);
                        }}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedTicketIds.has(ticket.id)}
                            onCheckedChange={() => toggleSelectTicket(ticket.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="font-mono text-xs text-neutral-500">
                              {ticket.ticket_number}
                            </span>
                            <p className="font-medium truncate max-w-[200px]">
                              {ticket.subject}
                            </p>
                            {(ticket as any).source === "email" && (
                              <Badge variant="outline" className="text-xs mt-1">
                                Via Email
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-neutral-600 dark:text-neutral-400">
                            {ticket.user_email || ticket.contact_email || "Unknown"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={STATUS_COLORS[ticket.status]}>
                            {TICKET_STATUS_LABELS[ticket.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={PRIORITY_COLORS[ticket.priority]}>
                            {TICKET_PRIORITY_LABELS[ticket.priority]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isBreached ? (
                            <Badge variant="destructive" className="text-xs">
                              Breached
                            </Badge>
                          ) : slaStatus.percentage >= 75 ? (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">
                              {slaStatus.percentage}%
                            </Badge>
                          ) : ticket.resolution_sla_hours ? (
                            <span className="text-xs text-neutral-500">
                              {slaStatus.percentage}%
                            </span>
                          ) : (
                            <span className="text-xs text-neutral-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {ticket.assigned_to_email ? (
                            <span className="text-sm text-neutral-600 dark:text-neutral-400">
                              {ticket.assigned_to_email.split("@")[0]}
                            </span>
                          ) : (
                            <span className="text-sm text-neutral-400">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-neutral-500">
                            {safeFormatDistanceToNow(ticket.created_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-neutral-400" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="workload" className="space-y-4">
          {/* Support Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Support Settings</CardTitle>
              <CardDescription>Configure real-time support features</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="online-status-toggle" className="text-sm font-medium">
                    Show online status to customers
                  </Label>
                  <p className="text-xs text-neutral-500">
                    Allow customers to see if support staff are online
                  </p>
                </div>
                <Switch
                  id="online-status-toggle"
                  checked={showOnlineStatusToCustomers}
                  onCheckedChange={async (checked) => {
                    setIsSavingSettings(true);
                    try {
                      // TODO: Implement API call to save setting
                      setShowOnlineStatusToCustomers(checked);
                      toast.success(`Online status ${checked ? 'enabled' : 'disabled'} for customers`);
                    } catch (error) {
                      toast.error("Failed to update setting");
                    } finally {
                      setIsSavingSettings(false);
                    }
                  }}
                  disabled={isSavingSettings}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Staff workload distribution
            </p>
            {workload?.unassigned_count ? (
              <Badge variant="secondary">
                {workload.unassigned_count} unassigned tickets
              </Badge>
            ) : null}
          </div>

          {!workload || workload.staff.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  No staff members with assignments
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400">
                  Tickets will appear here when assigned to staff
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {workload.staff.map((staff) => (
                <WorkloadCard
                  key={staff.user_id}
                  staff={staff}
                  presenceStatus={presenceMap[staff.user_id] || null}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Ticket Detail Sheet */}
      <TicketDetailSheet
        ticket={selectedTicket}
        open={!!selectedTicket}
        onOpenChange={(open) => !open && setSelectedTicket(null)}
        templates={templates}
      />

      {/* Floating Batch Action Bar */}
      <BatchActionBar
        selectedCount={selectedTicketIds.size}
        onClear={clearSelection}
        onBatchAssign={handleBatchAssign}
        onBatchStatus={handleBatchStatus}
        isLoading={batchAssign.isPending || batchStatus.isPending}
      />

      {/* WebSocket Connection Status - Top Right */}
      {wsStatus === "connected" && (
        <div className="fixed top-4 right-4 z-50 pointer-events-none">
          <Badge variant="outline" className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2" />
            Live
          </Badge>
        </div>
      )}
    </div>
  );
}

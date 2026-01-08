"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { safeFormatDate, safeFormatDistanceToNow } from "@/lib/utils/date";
import { ArrowLeft, Send, Loader2, User, Shield, Clock, CheckCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useTicket, useReplyToTicket, useCloseTicket, supportKeys } from "@/lib/api/hooks";
import { useOrganizationId, useAuth } from "@/providers/auth-provider";
import {
  useWebSocket,
  useTicketSubscription,
  useTypingIndicator,
  useTicketViewers,
  useTypingUsers,
  useWebSocketEvent,
} from "@/lib/websocket/hooks";
import {
  TICKET_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_CATEGORY_LABELS,
  type TicketStatus,
} from "@/types/support";
import type { TicketMessageWithSender } from "@/types/support";

// Status badge colors
const STATUS_COLORS: Record<TicketStatus, string> = {
  open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_response: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  resolved: "bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900/30 dark:text-neutral-500",
};

function MessageBubble({ message }: { message: TicketMessageWithSender }) {
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
          isAdmin
            ? "bg-blue-50 dark:bg-blue-900/20 text-left"
            : "bg-neutral-100 dark:bg-neutral-800 text-left"
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {message.sender_name || (isAdmin ? "Support Team" : "You")}
            </span>
            {isAdmin && (
              <Badge variant="secondary" className="text-xs">
                Support
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

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.ticketId as string;
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth(); // ← Use auth context for token

  const { data: ticket, isLoading, refetch: refetchTicket } = useTicket(ticketId);
  const replyToTicket = useReplyToTicket(organizationId);
  const closeTicket = useCloseTicket(organizationId);

  const [replyContent, setReplyContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [ticket?.messages]);

  // WebSocket integration for real-time features
  const { status: wsStatus } = useWebSocket(accessToken || undefined);

  // Subscribe to this ticket's updates
  useTicketSubscription(ticketId);

  // Typing indicator
  const { handleTyping, handleStopTyping } = useTypingIndicator(ticketId);

  // Track who's viewing and typing
  const viewers = useTicketViewers(ticketId);
  const typingUsers = useTypingUsers(ticketId);

  // Listen for real-time updates - actively refetch when new messages arrive
  useWebSocketEvent("new_message", (data: any) => {
    if (data.ticket_id === ticketId) {
      refetchTicket();
    }
  }, [ticketId]);

  useWebSocketEvent("ticket_updated", (data: any) => {
    if (data.ticket_id === ticketId) {
      refetchTicket();
    }
  }, [ticketId]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!replyContent.trim()) {
      toast.error("Please enter a message");
      return;
    }

    // Stop typing indicator
    handleStopTyping();

    try {
      await replyToTicket.mutateAsync({
        ticketId,
        content: replyContent.trim(),
      });
      setReplyContent("");
      toast.success("Reply sent!");

      // Refetch the ticket to show the new message immediately
      await refetchTicket();

      // Scroll to bottom to show the new message
      setTimeout(scrollToBottom, 100);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send reply");
    }
  };

  const handleClose = async () => {
    try {
      await closeTicket.mutateAsync(ticketId);
      toast.success("Ticket closed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close ticket");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
          Ticket not found
        </h2>
        <p className="text-neutral-500 dark:text-neutral-400 mb-4">
          The ticket you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link href="/support">
          <Button>Back to My Tickets</Button>
        </Link>
      </div>
    );
  }

  const isClosed = ticket.status === "closed" || ticket.status === "resolved";

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/support"
        className="inline-flex items-center text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to My Tickets
      </Link>

      {/* Ticket Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
                  {ticket.ticket_number}
                </span>
                <Badge variant="secondary" className={STATUS_COLORS[ticket.status]}>
                  {TICKET_STATUS_LABELS[ticket.status]}
                </Badge>
              </div>
              <CardTitle className="text-xl">{ticket.subject}</CardTitle>
            </div>
            {!isClosed && (
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={closeTicket.isPending}
              >
                {closeTicket.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Close Ticket
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm text-neutral-500 dark:text-neutral-400">
            <div className="flex items-center gap-1">
              <span className="font-medium">Category:</span>
              <span>{TICKET_CATEGORY_LABELS[ticket.category]}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-medium">Priority:</span>
              <span>{TICKET_PRIORITY_LABELS[ticket.priority]}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>Created {safeFormatDistanceToNow(ticket.created_at)}</span>
            </div>
            {ticket.resolved_at && (
              <div className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4" />
                <span>Resolved {safeFormatDistanceToNow(ticket.resolved_at)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Messages Thread */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {ticket.messages?.length > 0 ? (
              ticket.messages.map((message, index) => (
                <div key={message.id}>
                  <MessageBubble message={message} />
                  {index < ticket.messages.length - 1 && (
                    <Separator className="my-6" />
                  )}
                </div>
              ))
            ) : (
              <p className="text-center text-neutral-500 dark:text-neutral-400 py-8">
                No messages yet
              </p>
            )}
            {/* Invisible element to scroll to */}
            <div ref={messagesEndRef} />
          </div>
        </CardContent>
      </Card>

      {/* Reply Form */}
      {!isClosed ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reply</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReply} className="space-y-4">
              {/* Viewers and Typing Indicators */}
              {(viewers.length > 0 || typingUsers.length > 0) && (
                <div className="flex flex-col gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {viewers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span>
                        {viewers.length} {viewers.length === 1 ? "person" : "people"} viewing
                      </span>
                    </div>
                  )}
                  {typingUsers.length > 0 && (
                    <div className="flex items-center gap-2 italic">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>
                        {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
                      </span>
                    </div>
                  )}
                </div>
              )}

              <Textarea
                placeholder="Type your message..."
                value={replyContent}
                onChange={(e) => {
                  setReplyContent(e.target.value);
                  handleTyping();
                }}
                onKeyDown={(e) => {
                  // Submit on Enter, new line on Shift+Enter
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReply(e as any);
                  }
                }}
                rows={4}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={replyToTicket.isPending}>
                  {replyToTicket.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send Reply
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-neutral-50 dark:bg-neutral-900">
          <CardContent className="py-6 text-center">
            <CheckCircle className="h-8 w-8 mx-auto text-neutral-400 mb-2" />
            <p className="text-neutral-500 dark:text-neutral-400">
              This ticket is {ticket.status}. You can create a new ticket if you need further assistance.
            </p>
            <Link href="/support/new">
              <Button variant="outline" className="mt-4">
                Create New Ticket
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

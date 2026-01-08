"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plus, Ticket, Search, Filter, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTickets } from "@/lib/api/hooks";
import { useOrganizationId } from "@/providers/auth-provider";
import {
  TICKET_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_CATEGORY_LABELS,
  type TicketStatus,
} from "@/types/support";
import type { SupportTicketWithDetails } from "@/types/support";

// Status badge colors
const STATUS_COLORS: Record<TicketStatus, string> = {
  open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_response: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  resolved: "bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900/30 dark:text-neutral-500",
};

function TicketCard({ ticket }: { ticket: SupportTicketWithDetails }) {
  return (
    <Link href={`/support/${ticket.id}`}>
      <Card className="hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
                  {ticket.ticket_number}
                </span>
                <Badge variant="secondary" className={STATUS_COLORS[ticket.status]}>
                  {TICKET_STATUS_LABELS[ticket.status]}
                </Badge>
              </div>
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {ticket.subject}
              </h3>
              <div className="flex items-center gap-3 mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                <span>{TICKET_CATEGORY_LABELS[ticket.category]}</span>
                <span>-</span>
                <span>{TICKET_PRIORITY_LABELS[ticket.priority]}</span>
                <span>-</span>
                <span>{formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</span>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400 shrink-0" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function SupportPage() {
  const organizationId = useOrganizationId();
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: tickets, isLoading } = useTickets(
    organizationId,
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );

  // Filter tickets by search query
  const filteredTickets = (tickets ?? []).filter((ticket: SupportTicketWithDetails) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ticket.subject.toLowerCase().includes(query) ||
      ticket.ticket_number.toLowerCase().includes(query)
    );
  });

  // Group tickets by status for summary
  const statusCounts = (tickets ?? []).reduce((acc: Record<TicketStatus, number>, ticket: SupportTicketWithDetails) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {} as Record<TicketStatus, number>);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            My Tickets
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            View and manage your support tickets
          </p>
        </div>
        <Link href="/support/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Ticket
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-neutral-500 dark:text-neutral-400">Open</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {statusCounts.open || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-neutral-500 dark:text-neutral-400">In Progress</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {statusCounts.in_progress || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-neutral-500 dark:text-neutral-400">Awaiting Response</div>
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {statusCounts.awaiting_response || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-neutral-500 dark:text-neutral-400">Resolved</div>
            <div className="text-2xl font-bold text-neutral-600 dark:text-neutral-400">
              {(statusCounts.resolved || 0) + (statusCounts.closed || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <Input
            placeholder="Search tickets..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TicketStatus | "all")}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="awaiting_response">Awaiting Response</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tickets List */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Ticket className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              {searchQuery || statusFilter !== "all" ? "No tickets found" : "No tickets yet"}
            </h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-4">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Create a new ticket to get help from our support team"}
            </p>
            {!searchQuery && statusFilter === "all" && (
              <Link href="/support/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Ticket
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredTickets.map((ticket: SupportTicketWithDetails) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}

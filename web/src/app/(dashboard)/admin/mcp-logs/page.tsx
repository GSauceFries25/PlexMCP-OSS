"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow, isValid } from "date-fns";

// Safe date parsing to prevent RangeError: Invalid time value
function safeParseDate(dateValue: string | Date | null | undefined): Date | null {
  if (!dateValue) return null;
  try {
    const date = new Date(dateValue);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

// Safe date formatting with fallback
function safeFormatDate(dateValue: string | Date | null | undefined, formatStr: string): string {
  const date = safeParseDate(dateValue);
  if (!date) return "Unknown";
  try {
    return format(date, formatStr);
  } catch {
    return "Unknown";
  }
}

// Safe relative time formatting with fallback
function safeFormatDistanceToNow(dateValue: string | Date | null | undefined): string {
  const date = safeParseDate(dateValue);
  if (!date) return "Unknown";
  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  ShieldX,
  Download,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Server,
  Building2,
  ChevronLeft,
  ChevronRight,
  Timer,
} from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useAuth } from "@/providers/auth-provider";
import {
  useAdminMcpLogs,
  useAdminMcpMethods,
  type McpProxyLogEntry,
  type McpProxyLogFilters,
  type McpProxyLogStatus,
} from "@/lib/api/hooks";

// =============================================================================
// Constants
// =============================================================================

const STATUS_OPTIONS: { value: McpProxyLogStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "timeout", label: "Timeout" },
];

const DATE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "1h", label: "Last Hour" },
  { value: "24h", label: "Last 24 Hours" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

const PER_PAGE_OPTIONS = [25, 50, 100];

// Status badge colors
const STATUS_COLORS: Record<McpProxyLogStatus, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  timeout: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

// Status icons
const STATUS_ICONS: Record<McpProxyLogStatus, React.ReactNode> = {
  success: <CheckCircle2 className="h-3 w-3" />,
  error: <XCircle className="h-3 w-3" />,
  timeout: <Clock className="h-3 w-3" />,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get latency color based on milliseconds
 * Green: <200ms, Amber: 200-500ms, Red: >500ms
 */
function getLatencyColor(latencyMs: number | null): string {
  if (latencyMs === null) return "text-neutral-500";
  if (latencyMs < 200) return "text-green-600 dark:text-green-400";
  if (latencyMs < 500) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Format latency display
 */
function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "-";
  if (latencyMs < 1000) return `${latencyMs}ms`;
  return `${(latencyMs / 1000).toFixed(2)}s`;
}

/**
 * Export logs to CSV
 */
function exportToCSV(logs: McpProxyLogEntry[], filename: string): void {
  const headers = [
    "Timestamp",
    "MCP Name",
    "Organization",
    "Method",
    "Tool Name",
    "Status",
    "Latency (ms)",
    "Error Message",
  ];

  const rows = logs.map((log) => [
    safeFormatDate(log.created_at, "yyyy-MM-dd HH:mm:ss"),
    log.mcp_name,
    log.org_name,
    log.method,
    log.tool_name || "",
    log.status,
    log.latency_ms?.toString() || "",
    log.error_message || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// =============================================================================
// Components
// =============================================================================

/** Stats Card Component */
function StatsCard({
  title,
  value,
  icon,
  description,
  trend,
  isLoading,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  trend?: { value: number; isPositive: boolean };
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-8 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-neutral-500">{icon}</div>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">{title}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {trend && (
            <span
              className={`text-xs ${
                trend.isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {trend.isPositive ? "+" : ""}
              {trend.value}%
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-neutral-500 mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Log Row Component for better performance with memo */
const LogRow = ({
  log,
  onRowClick,
}: {
  log: McpProxyLogEntry;
  onRowClick?: (log: McpProxyLogEntry) => void;
}) => {
  return (
    <TableRow
      className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
      onClick={() => onRowClick?.(log)}
    >
      <TableCell className="font-mono text-xs">
        {safeFormatDate(log.created_at, "MMM d, HH:mm:ss")}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-neutral-400" />
          <span className="font-medium truncate max-w-[150px]" title={log.mcp_name}>
            {log.mcp_name}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-neutral-400" />
          <span className="text-sm text-neutral-600 dark:text-neutral-400 truncate max-w-[120px]" title={log.org_name}>
            {log.org_name}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="space-y-0.5">
          <span className="font-mono text-sm">{log.method}</span>
          {log.tool_name && (
            <p className="text-xs text-neutral-500 truncate max-w-[150px]" title={log.tool_name}>
              {log.tool_name}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={STATUS_COLORS[log.status]}>
          {STATUS_ICONS[log.status]}
          <span className="ml-1 capitalize">{log.status}</span>
        </Badge>
      </TableCell>
      <TableCell>
        <span className={`font-mono text-sm ${getLatencyColor(log.latency_ms)}`}>
          {formatLatency(log.latency_ms)}
        </span>
      </TableCell>
      <TableCell className="max-w-[200px]">
        {log.error_message ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-red-600 dark:text-red-400 truncate block cursor-help">
                  {log.error_message}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[400px]">
                <p className="text-sm">{log.error_message}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-neutral-400">-</span>
        )}
      </TableCell>
    </TableRow>
  );
};

/** Loading skeleton for table rows */
function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <>
      {[...Array(rows)].map((_, i) => (
        <TableRow key={i}>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-6 w-16" /></TableCell>
          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** Empty state component */
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Activity className="h-12 w-12 text-neutral-400 mb-4" />
      <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
        No logs found
      </h3>
      <p className="text-neutral-500 dark:text-neutral-400 max-w-md">
        {hasFilters
          ? "Try adjusting your filters or search query to find more results."
          : "MCP proxy logs will appear here as requests are made."}
      </p>
    </div>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function AdminMcpLogsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<McpProxyLogStatus | "all">("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<string>("24h");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast.error("Access denied. Admin privileges required.");
      router.push("/");
    }
  }, [authLoading, isAdmin, router]);

  // Build filters object
  const filters: McpProxyLogFilters = useMemo(() => {
    const f: McpProxyLogFilters = {
      page,
      per_page: perPage,
    };
    if (statusFilter !== "all") f.status = statusFilter;
    if (methodFilter !== "all") f.method = methodFilter;
    if (dateRangeFilter !== "all") f.date_range = dateRangeFilter as McpProxyLogFilters["date_range"];
    if (debouncedSearch) f.search = debouncedSearch;
    return f;
  }, [statusFilter, methodFilter, dateRangeFilter, debouncedSearch, page, perPage]);

  const hasFilters = statusFilter !== "all" || methodFilter !== "all" || dateRangeFilter !== "all" || debouncedSearch !== "";

  // Fetch data
  const shouldFetch = !authLoading && isAdmin;
  const { data: logsData, isLoading, error, refetch, isFetching } = useAdminMcpLogs(
    filters,
    shouldFetch
  );
  const { data: methods } = useAdminMcpMethods(shouldFetch);

  // Memoize stats calculation
  const stats = useMemo(() => {
    if (!logsData?.stats) {
      return {
        totalRequests: 0,
        successRate: 0,
        errorCount: 0,
        avgLatency: null as number | null,
      };
    }
    return {
      totalRequests: logsData.stats.total_requests,
      successRate: logsData.stats.success_rate,
      errorCount: logsData.stats.error_count + logsData.stats.timeout_count,
      avgLatency: logsData.stats.avg_latency_ms,
    };
  }, [logsData?.stats]);

  // Handlers
  const handleRefresh = useCallback(() => {
    refetch();
    toast.success("Logs refreshed");
  }, [refetch]);

  const handleExportCSV = useCallback(() => {
    if (!logsData?.logs?.length) {
      toast.error("No logs to export");
      return;
    }
    const filename = `mcp-logs-${format(new Date(), "yyyy-MM-dd-HHmmss")}.csv`;
    exportToCSV(logsData.logs, filename);
    toast.success(`Exported ${logsData.logs.length} logs to ${filename}`);
  }, [logsData?.logs]);

  const handleClearFilters = useCallback(() => {
    setStatusFilter("all");
    setMethodFilter("all");
    setDateRangeFilter("24h");
    setSearchQuery("");
    setPage(1);
  }, []);

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

  // Show error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load MCP Logs</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          {(error as Error)?.message || "An error occurred while loading logs. Please try again."}
        </p>
        <Button onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            MCP Proxy Logs
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Monitor and debug MCP proxy requests across all organizations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportCSV} disabled={!logsData?.logs?.length}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatsCard
          title="Total Requests"
          value={stats.totalRequests}
          icon={<Activity className="h-4 w-4 text-blue-500" />}
          description="In selected time range"
          isLoading={isLoading}
        />
        <StatsCard
          title="Success Rate"
          value={`${stats.successRate.toFixed(1)}%`}
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          description="Successful requests"
          isLoading={isLoading}
        />
        <StatsCard
          title="Errors"
          value={stats.errorCount}
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          description="Errors and timeouts"
          isLoading={isLoading}
        />
        <StatsCard
          title="Avg Latency"
          value={formatLatency(stats.avgLatency)}
          icon={<Timer className="h-4 w-4 text-amber-500" />}
          description="Average response time"
          isLoading={isLoading}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                placeholder="Search MCP name, tool, or error..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as McpProxyLogStatus | "all"); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Method Filter */}
            <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {methods?.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date Range Filter */}
            <Select value={dateRangeFilter} onValueChange={(v) => { setDateRangeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Date Range" />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear Filters */}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                Clear Filters
              </Button>
            )}

            {/* Auto-refresh indicator */}
            <div className="flex items-center gap-2 text-xs text-neutral-500 ml-auto">
              <Zap className="h-3 w-3" />
              <span>Auto-refresh: 30s</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Timestamp</TableHead>
              <TableHead>MCP Name</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Method / Tool</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[90px]">Latency</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={perPage} />
            ) : !logsData?.logs?.length ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState hasFilters={hasFilters} />
                </TableCell>
              </TableRow>
            ) : (
              logsData.logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {logsData && logsData.total_pages > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t gap-4">
            <div className="flex items-center gap-4">
              <p className="text-sm text-neutral-500">
                Page {page} of {logsData.total_pages} ({logsData.total.toLocaleString()} total)
              </p>
              <Select value={perPage.toString()} onValueChange={(v) => { setPerPage(parseInt(v)); setPage(1); }}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PER_PAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt.toString()}>
                      {opt} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= logsData.total_pages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

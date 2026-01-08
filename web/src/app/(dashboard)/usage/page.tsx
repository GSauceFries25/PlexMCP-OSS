"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
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
import { Activity, TrendingUp, Server, Clock, Zap, AlertCircle } from "lucide-react";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import {
  useUsageSummary,
  useHourlyUsage,
  useMcpUsage,
  useRecentErrors,
  useLatencyDistribution,
  useMCPs,
  type TimeRange,
} from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

// Dynamic import with SSR disabled to prevent hydration mismatch from date calculations
const UsageVolumeChart = dynamic(
  () => import("@/components/dashboard/usage-volume-chart").then(mod => mod.UsageVolumeChart),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-[240px] w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    ),
  }
);

export default function UsagePage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync, user } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

  // Fetch real data from the new analytics endpoints
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useUsageSummary(organizationId, timeRange);
  const { data: hourlyData, isLoading: hourlyLoading } = useHourlyUsage(organizationId, timeRange);
  const { data: mcpUsageData, isLoading: mcpUsageLoading } = useMcpUsage(organizationId, timeRange);
  const { data: recentErrors, isLoading: errorsLoading } = useRecentErrors(organizationId, timeRange, 10);
  const { data: latencyDist, isLoading: latencyLoading } = useLatencyDistribution(organizationId, timeRange);
  const { data: mcps, isLoading: mcpsLoading } = useMCPs(organizationId);

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use GLOBAL flag for synchronous detection, plus context-based checks
  const isLoading = globalSigningOut || organizationsLoading || summaryLoading || hourlyLoading || mcpUsageLoading || errorsLoading || latencyLoading || mcpsLoading || isSigningOut || signingOutNow;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-48 mb-2" />
            <Skeleton className="h-5 w-72" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[200px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // If user is null, they're signing out or not logged in - show loading
  if (!currentOrganization) {
    if (!user) {
      return (
        <div className="space-y-6">
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Activity className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  if (summaryError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Activity className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Error Loading Usage</h2>
        <p className="text-muted-foreground">{summaryError.message}</p>
      </div>
    );
  }

  // Extract real values from summary
  const totalRequests = summary?.total_requests ?? 0;
  const totalErrors = summary?.total_errors ?? 0;
  const avgLatency = summary?.avg_latency_ms ?? 0;
  const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : "0.00";
  const activeMCPs = mcps?.filter((m) => m.is_active).length ?? 0;

  // Format time for relative display
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usage & Analytics</h1>
          <p className="text-muted-foreground">
            Monitor API usage, performance metrics, and MCP activity
          </p>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRequests.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              In selected period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{errorRate}%</div>
            <p className="text-xs text-muted-foreground">
              {totalErrors.toLocaleString()} error{totalErrors !== 1 ? "s" : ""} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgLatency}ms</div>
            <p className="text-xs text-muted-foreground">
              Average response time
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active MCPs</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeMCPs}</div>
            <p className="text-xs text-muted-foreground">
              {mcps?.length ?? 0} total configured
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request Volume</CardTitle>
          <CardDescription>Daily API requests over the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageVolumeChart hourlyData={hourlyData} timeRange={timeRange} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>MCP Performance</CardTitle>
            <CardDescription>Usage breakdown by MCP endpoint</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(mcpUsageData ?? []).length > 0 ? (
                (mcpUsageData ?? []).slice(0, 6).map((mcp) => (
                  <div key={mcp.mcp_instance_id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{mcp.mcp_name}</span>
                      </div>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>{mcp.request_count.toLocaleString()} requests</span>
                        <span>{mcp.avg_latency_ms ?? 0}ms avg</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {mcp.request_count > 0
                          ? ((mcp.error_count / mcp.request_count) * 100).toFixed(1)
                          : "0.0"}%
                      </div>
                      <div className="text-xs text-muted-foreground">error rate</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-8 w-8 mx-auto mb-2" />
                  <p>No MCP usage data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latency Distribution</CardTitle>
            <CardDescription>Response time breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {latencyDist && latencyDist.total_requests > 0 ? (
              <div className="space-y-4">
                {latencyDist.buckets.map((bucket) => (
                  <div key={bucket.range} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{bucket.range}</span>
                      <span className="text-muted-foreground">{bucket.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${getLatencyColor(bucket.range)}`}
                        style={{ width: `${bucket.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-4 border-t">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">P50</div>
                      <div className="text-sm text-muted-foreground">{latencyDist.p50_ms}ms</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">P95</div>
                      <div className="text-sm text-muted-foreground">{latencyDist.p95_ms}ms</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">P99</div>
                      <div className="text-sm text-muted-foreground">{latencyDist.p99_ms}ms</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <Clock className="h-8 w-8 mb-2" />
                <p>No latency data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>Latest API errors and failures</CardDescription>
        </CardHeader>
        <CardContent>
          {(recentErrors ?? []).length > 0 ? (
            <div className="space-y-4">
              {(recentErrors ?? []).map((error) => (
                <div
                  key={error.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-destructive/20 bg-destructive/5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {error.status}
                      </Badge>
                      <code className="text-sm">{error.method}</code>
                      {error.tool_name && (
                        <span className="text-xs text-muted-foreground">({error.tool_name})</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {error.error_message || "Unknown error"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(error.created_at)}
                    </span>
                    {error.latency_ms && (
                      <div className="text-xs text-muted-foreground">{error.latency_ms}ms</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-500" />
              <p>No errors in the selected time period</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function to get color based on latency range
function getLatencyColor(range: string): string {
  if (range.includes("<100") || range.includes("< 100")) return "bg-green-500";
  if (range.includes("100-200") || range.includes("100ms-200ms")) return "bg-blue-500";
  if (range.includes("200-500") || range.includes("200ms-500ms")) return "bg-yellow-500";
  return "bg-red-500";
}

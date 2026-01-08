"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Plug,
  Server,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { useMCPs, useTestAllMCPs } from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import type { MCP } from "@/types/database";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

export default function TestingPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync, user } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: mcps, isLoading, error } = useMCPs(organizationId);
  const testAllMCPs = useTestAllMCPs(organizationId);

  const [lastTestTime, setLastTestTime] = useState<Date | null>(null);

  const handleTestAll = async () => {
    try {
      const result = await testAllMCPs.mutateAsync();
      setLastTestTime(new Date());
      toast.success(
        `Tested ${result.total} MCPs: ${result.healthy} healthy, ${result.unhealthy} unhealthy`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to test all MCPs"
      );
    }
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins === 1) return "1 min ago";
    if (diffMins < 60) return `${diffMins} mins ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return "1 hour ago";
    return `${diffHours} hours ago`;
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Helper to get endpoint URL from MCP
  const getEndpointUrl = (mcp: MCP): string => {
    if (mcp.endpoint_url) return mcp.endpoint_url;
    if (mcp.config && typeof mcp.config === "object" && mcp.config !== null) {
      const config = mcp.config as Record<string, unknown>;
      if (typeof config.endpoint_url === "string") return config.endpoint_url;
    }
    return "";
  };

  // Helper to get health status display
  const getHealthStatus = (mcp: MCP) => {
    const status = mcp.health_status || "unknown";
    switch (status) {
      case "healthy":
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
          badge: <Badge variant="default" className="bg-green-500">Healthy</Badge>,
          color: "text-green-500",
        };
      case "unhealthy":
        return {
          icon: <XCircle className="h-4 w-4 text-red-500" />,
          badge: <Badge variant="destructive">Unhealthy</Badge>,
          color: "text-red-500",
        };
      default:
        return {
          icon: <AlertCircle className="h-4 w-4 text-yellow-500" />,
          badge: <Badge variant="secondary">Unknown</Badge>,
          color: "text-yellow-500",
        };
    }
  };

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || isLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-40 mb-2" />
            <Skeleton className="h-5 w-72" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-12 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
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
          <Skeleton className="h-9 w-32 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Plug className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get
          started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Plug className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Error Loading MCPs</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  const mcpList = mcps ?? [];
  const healthyCount = mcpList.filter((m) => m.health_status === "healthy").length;
  const unhealthyCount = mcpList.filter((m) => m.health_status === "unhealthy").length;
  const avgLatency = mcpList.length > 0 && mcpList.some(m => m.last_latency_ms)
    ? Math.round(
        mcpList
          .filter((m) => m.last_latency_ms)
          .reduce((sum, m) => sum + (m.last_latency_ms || 0), 0) /
          mcpList.filter((m) => m.last_latency_ms).length
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">MCP Testing</h1>
          <p className="text-muted-foreground">
            Test and troubleshoot your MCP connections
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lastTestTime && (
            <span className="text-sm text-muted-foreground">
              Last tested: {formatRelativeTime(lastTestTime)}
            </span>
          )}
          <Button
            onClick={handleTestAll}
            disabled={testAllMCPs.isPending || mcpList.length === 0}
          >
            {testAllMCPs.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Test All MCPs
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total MCPs</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mcpList.length}</div>
            <p className="text-xs text-muted-foreground">
              Configured endpoints
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Healthy</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{healthyCount}</div>
            <p className="text-xs text-muted-foreground">
              Passing health checks
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unhealthy</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{unhealthyCount}</div>
            <p className="text-xs text-muted-foreground">
              Failing health checks
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgLatency !== null ? `${avgLatency}ms` : ""}
            </div>
            <p className="text-xs text-muted-foreground">
              Response time
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>MCP Connection Status</CardTitle>
          <CardDescription>
            Click on an MCP to view detailed test results and troubleshooting
            information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MCP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Last Check</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcpList.map((mcp) => {
                const healthStatus = getHealthStatus(mcp);
                return (
                  <TableRow key={mcp.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          {healthStatus.icon}
                        </div>
                        <div>
                          <div className="font-medium">{mcp.name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {getEndpointUrl(mcp) || "No endpoint configured"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{healthStatus.badge}</TableCell>
                    <TableCell>
                      {mcp.tools_count !== undefined && mcp.tools_count !== null ? (
                        <span className="font-medium">{mcp.tools_count}</span>
                      ) : (
                        <span className="text-muted-foreground"></span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mcp.last_latency_ms ? (
                        <span
                          className={
                            mcp.last_latency_ms < 200
                              ? "text-green-600"
                              : mcp.last_latency_ms < 500
                              ? "text-yellow-600"
                              : "text-red-600"
                          }
                        >
                          {mcp.last_latency_ms}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground"></span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mcp.last_health_check ? (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(mcp.last_health_check)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/testing/${mcp.id}`}>
                        <Button variant="outline" size="sm">
                          Details
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {mcpList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Plug className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        No MCPs configured yet
                      </p>
                      <Link href="/mcps">
                        <Button variant="outline" size="sm">
                          Add your first MCP
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

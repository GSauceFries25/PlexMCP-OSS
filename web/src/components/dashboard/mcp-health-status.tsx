"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Server, ArrowRight } from "lucide-react";
import { useOrganizationId } from "@/providers/auth-provider";
import { useMCPs } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export function McpHealthStatus() {
  const organizationId = useOrganizationId();
  const { data: mcps, isLoading } = useMCPs(organizationId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayedMcps = mcps?.slice(0, 5) ?? [];
  const hasMore = (mcps?.length ?? 0) > 5;
  const onlineCount = mcps?.filter(m => m.is_active && m.health_status === "healthy").length ?? 0;
  const totalCount = mcps?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">MCP Health Status</CardTitle>
          <CardDescription>
            {onlineCount} of {totalCount} online
          </CardDescription>
        </div>
        <Server className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {displayedMcps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Server className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No MCPs configured</p>
            <Link
              href="/mcps"
              className="text-sm text-primary hover:underline mt-1"
            >
              Add your first MCP
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedMcps.map((mcp) => {
              const isOnline = mcp.is_active && mcp.health_status === "healthy";
              const statusColor = isOnline ? "bg-green-500" : "bg-red-500";
              const statusText = isOnline ? "Online" : "Offline";

              return (
                <Link
                  key={mcp.id}
                  href={`/testing/${mcp.id}`}
                  className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("h-2.5 w-2.5 rounded-full", statusColor)} />
                    <span className="text-sm font-medium truncate max-w-[160px]">
                      {mcp.name}
                    </span>
                  </div>
                  <Badge variant={isOnline ? "outline" : "destructive"} className="text-xs">
                    {statusText}
                  </Badge>
                </Link>
              );
            })}
            {hasMore && (
              <Link
                href="/mcps"
                className="flex items-center justify-center gap-2 p-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View all {totalCount} MCPs
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

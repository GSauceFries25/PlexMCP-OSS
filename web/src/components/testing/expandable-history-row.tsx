"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Clock, Zap, Server, Wrench, FileText } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TestHistoryEntry {
  id: string;
  health_status: string;
  tested_at: string;
  latency_ms: number;
  error_message?: string | null;
  tools_count?: number | null;
  resources_count?: number | null;
  protocol_version?: string | null;
  server_name?: string | null;
  server_version?: string | null;
}

interface ExpandableHistoryRowProps {
  entry: TestHistoryEntry;
}

export function ExpandableHistoryRow({ entry }: ExpandableHistoryRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getHealthBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-500">Healthy</Badge>;
      case "unhealthy":
        return <Badge variant="destructive">Unhealthy</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 200) return "text-emerald-600 dark:text-emerald-400";
    if (ms < 500) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const handleCopyError = async () => {
    if (entry.error_message) {
      await navigator.clipboard.writeText(entry.error_message);
      setCopied(true);
      toast.success("Error message copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasDetails = entry.protocol_version || entry.server_name || entry.server_version ||
                     entry.tools_count != null || entry.resources_count != null;

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer hover:bg-muted/50 transition-colors",
          isExpanded && "bg-muted/30"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <TableCell className="w-8">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDateTime(entry.tested_at)}
          </div>
        </TableCell>
        <TableCell>{getHealthBadge(entry.health_status)}</TableCell>
        <TableCell>
          {entry.tools_count != null ? (
            <div className="flex items-center gap-1">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
              {entry.tools_count}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <span className={cn("font-mono", getLatencyColor(entry.latency_ms))}>
            {entry.latency_ms}ms
          </span>
        </TableCell>
        <TableCell className="max-w-[200px]">
          {entry.error_message ? (
            <span className="text-red-600 text-sm truncate block">
              {entry.error_message.substring(0, 50)}...
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={6} className="p-4">
            <div className="space-y-4">
              {/* Server Details */}
              {hasDetails && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div className="min-w-0">
                    <div className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Zap className="h-3.5 w-3.5 flex-shrink-0" />
                      Protocol
                    </div>
                    <div className="font-medium truncate" title={entry.protocol_version || undefined}>
                      {entry.protocol_version || "—"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Server className="h-3.5 w-3.5 flex-shrink-0" />
                      Server
                    </div>
                    <div className="font-medium truncate" title={entry.server_name || undefined}>
                      {entry.server_name || "—"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                      Version
                    </div>
                    <div className="font-medium truncate" title={entry.server_version || undefined}>
                      {entry.server_version || "—"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Wrench className="h-3.5 w-3.5 flex-shrink-0" />
                      Tools
                    </div>
                    <div className="font-medium">
                      {entry.tools_count ?? "—"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                      Resources
                    </div>
                    <div className="font-medium">
                      {entry.resources_count ?? "—"}
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {entry.error_message && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">
                      Error Details
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyError();
                      }}
                    >
                      {copied ? (
                        <Check className="h-3 w-3 mr-1" />
                      ) : (
                        <Copy className="h-3 w-3 mr-1" />
                      )}
                      Copy
                    </Button>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 font-mono text-xs text-red-700 dark:text-red-300 break-all">
                    {entry.error_message}
                  </div>
                </div>
              )}

              {!hasDetails && !entry.error_message && (
                <div className="text-sm text-muted-foreground text-center py-2">
                  No additional details available for this test
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

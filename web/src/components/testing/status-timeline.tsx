"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TestHistoryEntry {
  id: string;
  health_status: string;
  tested_at: string;
  latency_ms: number;
  error_message?: string | null;
}

interface StatusTimelineProps {
  history: TestHistoryEntry[];
  maxItems?: number;
  className?: string;
}

export function StatusTimeline({
  history,
  maxItems = 20,
  className
}: StatusTimelineProps) {
  if (!history || history.length === 0) {
    return null;
  }

  // Take most recent tests, reverse so oldest is first (left to right)
  const recentHistory = history.slice(0, maxItems).reverse();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "bg-emerald-500 hover:bg-emerald-400";
      case "unhealthy":
        return "bg-red-500 hover:bg-red-400";
      default:
        return "bg-yellow-500 hover:bg-yellow-400";
    }
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 200) return "text-emerald-600 dark:text-emerald-400";
    if (ms < 500) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Oldest</span>
        <span>Recent Status</span>
        <span>Latest</span>
      </div>
      <TooltipProvider>
        <div className="flex gap-0.5 h-8 items-center">
          {recentHistory.map((entry, idx) => (
            <Tooltip key={entry.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex-1 h-full rounded-sm cursor-pointer transition-all",
                    getStatusColor(entry.health_status),
                    "min-w-[8px] max-w-[20px]"
                  )}
                  style={{
                    opacity: 0.5 + (idx / recentHistory.length) * 0.5,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs space-y-1">
                  <div className="font-medium">{formatDate(entry.tested_at)}</div>
                  <div className="flex items-center justify-between gap-4">
                    <span className={cn(
                      "capitalize font-medium",
                      entry.health_status === "healthy" ? "text-emerald-500" : "text-red-500"
                    )}>
                      {entry.health_status}
                    </span>
                    <span className={getLatencyColor(entry.latency_ms)}>
                      {entry.latency_ms}ms
                    </span>
                  </div>
                  {entry.error_message && (
                    <div className="text-red-400 truncate max-w-[200px]">
                      {entry.error_message}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-muted-foreground">Healthy</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-red-500" />
            <span className="text-muted-foreground">Unhealthy</span>
          </div>
        </div>
        <span className="text-muted-foreground">
          {history.length} test{history.length !== 1 ? "s" : ""} total
        </span>
      </div>
    </div>
  );
}

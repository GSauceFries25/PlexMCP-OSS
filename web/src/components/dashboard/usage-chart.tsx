"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3 } from "lucide-react";
import { useOrganizationId } from "@/providers/auth-provider";
import { useHourlyUsage, useUsageSummary } from "@/lib/api/hooks";

// Dynamic import with SSR disabled to prevent hydration mismatch from date calculations
const UsageVolumeChart = dynamic(
  () => import("@/components/dashboard/usage-volume-chart").then(mod => mod.UsageVolumeChart),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    ),
  }
);

export function UsageChart() {
  const organizationId = useOrganizationId();
  const { data: hourlyUsage, isLoading: hourlyLoading } = useHourlyUsage(organizationId, "7d");
  const { data: summary, isLoading: summaryLoading } = useUsageSummary(organizationId, "7d");

  const isLoading = hourlyLoading || summaryLoading;
  const totalRequests = summary?.total_requests ?? 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48 mt-1" />
          </div>
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">Usage - Last 7 Days</CardTitle>
          <CardDescription>
            {totalRequests.toLocaleString()} total requests
          </CardDescription>
        </div>
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <UsageVolumeChart hourlyData={hourlyUsage} timeRange="7d" />
      </CardContent>
    </Card>
  );
}

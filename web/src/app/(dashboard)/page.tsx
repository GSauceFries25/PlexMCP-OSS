"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Key, Activity, TrendingUp, ArrowRight } from "lucide-react";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { useMCPs, useApiKeys, useUsageStats, useAuditLogs, useSubscription } from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { UsageChart } from "@/components/dashboard/usage-chart";
import { McpHealthStatus } from "@/components/dashboard/mcp-health-status";
import { OverageAlertBanner } from "@/components/dashboard/overage-alert-banner";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  isLoading,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  trend?: { value: number; positive: boolean };
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{description}</p>
          {trend && (
            <span
              className={`text-xs font-medium ${
                trend.positive ? "text-green-500" : "text-red-500"
              }`}
            >
              {trend.positive ? "+" : ""}{trend.value}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardStats() {
  const organizationId = useOrganizationId();
  const { data: mcps, isLoading: mcpsLoading } = useMCPs(organizationId);
  const { data: apiKeys, isLoading: apiKeysLoading } = useApiKeys(organizationId);
  const { data: usageStats, isLoading: usageLoading } = useUsageStats(organizationId);

  const activeMCPs = mcps?.filter(m => m.is_active).length ?? 0;
  const activeApiKeys = apiKeys?.length ?? 0;
  const totalRequests = usageStats?.total_requests ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total MCPs"
        value={activeMCPs.toString()}
        description="Active MCP endpoints"
        icon={Server}
        isLoading={mcpsLoading}
      />
      <StatCard
        title="API Keys"
        value={activeApiKeys.toString()}
        description="Active keys"
        icon={Key}
        isLoading={apiKeysLoading}
      />
      <StatCard
        title="Requests"
        value={totalRequests.toLocaleString()}
        description="Total API calls this period"
        icon={Activity}
        isLoading={usageLoading}
      />
      <StatCard
        title="Success Rate"
        value="99.9%"
        description="Request success rate"
        icon={TrendingUp}
        isLoading={usageLoading}
      />
    </div>
  );
}

function RecentActivity() {
  const organizationId = useOrganizationId();
  const { data: auditLogs, isLoading } = useAuditLogs(organizationId, 1, 5);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest actions in your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const activities = auditLogs?.items ?? [];

  // Format time ago
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    return `${Math.floor(diffInSeconds / 86400)} days ago`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest actions in your organization</CardDescription>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium capitalize">{activity.action.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">{activity.resource_type}</p>
                </div>
                <p className="text-xs text-muted-foreground">{formatTimeAgo(activity.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions() {
  const actions = [
    { title: "Add MCP", description: "Connect a new MCP endpoint", href: "/mcps" },
    { title: "Create API Key", description: "Generate a new API key", href: "/api-keys" },
    { title: "Invite Team Member", description: "Add someone to your team", href: "/team" },
    { title: "View Documentation", description: "Learn how to use PlexMCP", href: "https://docs.plexmcp.com" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {actions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div>
                <p className="text-sm font-medium">{action.title}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NoOrganization() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <Server className="h-16 w-16 text-muted-foreground" />
      <h2 className="text-xl font-semibold">No Organization Found</h2>
      <p className="text-muted-foreground text-center max-w-md">
        You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
      </p>
      <CreateOrganizationDialog />
    </div>
  );
}

export default function DashboardPage() {
  // CRITICAL: Check global signing out flag FIRST, before ANY React hooks
  // This is a module-level variable that updates synchronously
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync, user } = useAuth();
  const organizationId = useOrganizationId();
  const { data: subscription } = useSubscription(organizationId);
  const currentTier = subscription?.tier ?? "free";

  // Also check the context-based sync ref
  const signingOutNow = isSigningOutSync();

  // CRITICAL: Show loading if GLOBAL flag is set - this check happens before React context
  // Also show loading during normal sign out detection
  if (globalSigningOut || organizationsLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // If user is null, they're signing out or not logged in - show loading instead of "No Organization Found"
  if (!currentOrganization) {
    if (!user) {
      return (
        <div className="space-y-6">
          <div>
            <Skeleton className="h-9 w-48 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>
        </div>
      );
    }
    return <NoOrganization />;
  }

  return (
    <div className="space-y-6">
      <WelcomeHeader />

      {/* Overage Alert Banner - Shows when user has overages (paid tiers only) */}
      <OverageAlertBanner organizationId={organizationId} tier={currentTier} />

      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        }
      >
        <DashboardStats />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[200px]" />}>
        <UsageChart />
      </Suspense>

      <div className="grid gap-6 md:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-[300px]" />}>
          <McpHealthStatus />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[300px]" />}>
          <RecentActivity />
        </Suspense>
      </div>

      <Suspense fallback={<Skeleton className="h-[200px]" />}>
        <QuickActions />
      </Suspense>
    </div>
  );
}

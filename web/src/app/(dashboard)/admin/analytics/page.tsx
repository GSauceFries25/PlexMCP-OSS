"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, subDays, subHours, parseISO, isValid } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import {
  ArrowLeft,
  Activity,
  Users,
  Server,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Clock,
  RefreshCw,
  BarChart3,
  PieChartIcon,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  useAdminUsageSummary,
  useAdminUsageTimeSeries,
  useAdminRevenueMetrics,
  useAdminUserActivity,
  useAdminTopMcps,
  useAdminTopOrgs,
  useAdminSpendCapUtilization,
} from "@/lib/api/hooks/use-admin-analytics";

// Time range options
const TIME_RANGES = [
  { value: "24h", label: "24 Hours", days: 1, granularity: "hourly" as const },
  { value: "7d", label: "7 Days", days: 7, granularity: "daily" as const },
  { value: "30d", label: "30 Days", days: 30, granularity: "daily" as const },
  { value: "90d", label: "90 Days", days: 90, granularity: "weekly" as const },
];

// Chart colors
const CHART_COLORS = {
  requests: "hsl(var(--chart-1))",
  tokens: "hsl(var(--chart-2))",
  errors: "hsl(var(--chart-3))",
  latency: "hsl(var(--chart-4))",
};

// Tier colors for pie chart
const TIER_COLORS: Record<string, string> = {
  free: "#94a3b8",
  pro: "#3b82f6",
  team: "#8b5cf6",
  enterprise: "#f59e0b",
};

// Tier prices in cents (monthly)
const TIER_PRICES_CENTS: Record<string, number> = {
  free: 0,
  pro: 2900, // $29/month
  team: 9900, // $99/month
  enterprise: 49900, // $499/month
};

// Revenue chart colors
const REVENUE_CHART_COLORS = {
  mrr: "hsl(var(--chart-1))",
  overage: "hsl(var(--chart-2))",
};

// Format helpers
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatCentsExact(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPercent(num: number, decimals = 1): string {
  return `${num.toFixed(decimals)}%`;
}

// Chart config for usage chart
const usageChartConfig: ChartConfig = {
  requests: {
    label: "Requests",
    color: CHART_COLORS.requests,
  },
  tokens: {
    label: "Tokens",
    color: CHART_COLORS.tokens,
  },
  errors: {
    label: "Errors",
    color: CHART_COLORS.errors,
  },
};

// Chart config for revenue trend
const revenueChartConfig: ChartConfig = {
  mrr: {
    label: "MRR",
    color: REVENUE_CHART_COLORS.mrr,
  },
  overage: {
    label: "Overage",
    color: REVENUE_CHART_COLORS.overage,
  },
};

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [timeRange, setTimeRange] = useState("30d");
  const [activeTab, setActiveTab] = useState("usage");

  // Check if user is an admin - MUST be before data hooks so we can use it in `enabled`
  const isPlatformAdmin = useMemo(() => {
    // Check custom auth tokens first
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
    // Fall back to Supabase user metadata
    return ["admin", "superadmin", "staff"].includes((user as any)?.platform_role);
  }, [user]);

  // Only fetch data when auth is ready and user is admin
  const isReady = !authLoading && isPlatformAdmin;

  // Calculate date range based on selection
  const dateParams = useMemo(() => {
    const range = TIME_RANGES.find((r) => r.value === timeRange) || TIME_RANGES[2];
    const end = new Date();
    const start = range.days === 1 ? subHours(end, 24) : subDays(end, range.days);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      granularity: range.granularity,
    };
  }, [timeRange]);

  // Fetch all analytics data with error handling - only when auth is ready
  const { data: usageSummary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useAdminUsageSummary({
    start: dateParams.start,
    end: dateParams.end,
  }, isReady);

  const { data: usageTimeSeries, isLoading: timeSeriesLoading, error: timeSeriesError } = useAdminUsageTimeSeries({
    start: dateParams.start,
    end: dateParams.end,
    granularity: dateParams.granularity,
  }, isReady);

  const { data: revenueMetrics, isLoading: revenueLoading, error: revenueError } = useAdminRevenueMetrics(isReady);
  const { data: userActivity, isLoading: activityLoading, error: activityError } = useAdminUserActivity(isReady);
  const { data: topMcps, isLoading: mcpsLoading, error: mcpsError } = useAdminTopMcps({
    start: dateParams.start,
    end: dateParams.end,
  }, isReady);
  const { data: topOrgs, isLoading: orgsLoading, error: orgsError } = useAdminTopOrgs({
    start: dateParams.start,
    end: dateParams.end,
  }, isReady);
  const { data: spendCaps, isLoading: capsLoading, error: capsError } = useAdminSpendCapUtilization(isReady);

  // Check for critical errors
  const hasError = summaryError || timeSeriesError || revenueError || activityError;

  // Prepare chart data with safe date parsing - MUST be before conditional returns
  const chartData = useMemo(() => {
    if (!usageTimeSeries?.data) return [];

    return usageTimeSeries.data
      .filter((point) => point.timestamp) // Filter out null/undefined timestamps
      .map((point) => {
        let formattedTimestamp = "N/A";
        try {
          const date = typeof point.timestamp === "string"
            ? parseISO(point.timestamp)
            : new Date(point.timestamp);
          if (isValid(date)) {
            formattedTimestamp = format(date, dateParams.granularity === "hourly" ? "HH:mm" : "MMM dd");
          }
        } catch {
          // Keep default "N/A" if parsing fails
        }
        return {
          timestamp: formattedTimestamp,
          requests: point.requests || 0,
          tokens: point.tokens || 0,
          errors: point.errors || 0,
          latency: point.avg_latency_ms || 0,
        };
      });
  }, [usageTimeSeries?.data, dateParams.granularity]);

  // Prepare pie chart data for subscriptions - MUST be before conditional returns
  const subscriptionData = useMemo(() => {
    if (!revenueMetrics?.subscribers_by_tier) return [];
    return Object.entries(revenueMetrics.subscribers_by_tier).map(([tier, count]) => ({
      name: tier.charAt(0).toUpperCase() + tier.slice(1),
      value: count,
      fill: TIER_COLORS[tier] || "#6b7280",
    }));
  }, [revenueMetrics?.subscribers_by_tier]);

  // Prepare MRR trend chart data
  const mrrTrendData = useMemo(() => {
    if (!revenueMetrics?.trend || revenueMetrics.trend.length === 0) return [];

    return revenueMetrics.trend.map((point) => {
      let formattedDate = "N/A";
      try {
        const date = parseISO(point.date);
        if (isValid(date)) {
          formattedDate = format(date, "MMM d");
        }
      } catch {
        // Keep default "N/A" if parsing fails
      }
      return {
        date: formattedDate,
        mrr: point.mrr_cents / 100, // Convert cents to dollars
        overage: point.overage_cents / 100, // Convert cents to dollars
        total: (point.mrr_cents + point.overage_cents) / 100,
      };
    });
  }, [revenueMetrics?.trend]);

  // Prepare revenue by tier pie chart data (revenue, not subscriber count)
  const revenueByTierData = useMemo(() => {
    if (!revenueMetrics?.subscribers_by_tier) return [];

    const tierData = Object.entries(revenueMetrics.subscribers_by_tier)
      .map(([tier, count]) => {
        const pricePerMonth = TIER_PRICES_CENTS[tier] || 0;
        const revenueCents = count * pricePerMonth;
        return {
          name: tier.charAt(0).toUpperCase() + tier.slice(1),
          tier,
          subscribers: count,
          revenueCents,
          revenue: revenueCents / 100, // Convert to dollars
          fill: TIER_COLORS[tier] || "#6b7280",
        };
      })
      .filter((item) => item.revenueCents > 0); // Only show tiers with revenue

    // Calculate percentages
    const totalRevenue = tierData.reduce((sum, item) => sum + item.revenueCents, 0);
    return tierData.map((item) => ({
      ...item,
      percentage: totalRevenue > 0 ? (item.revenueCents / totalRevenue) * 100 : 0,
    }));
  }, [revenueMetrics?.subscribers_by_tier]);

  // Calculate growth metrics
  const growthMetrics = useMemo(() => {
    if (!revenueMetrics) {
      return {
        mrrGrowthRate: 0,
        arr: 0,
        totalSubscribers: 0,
        paidSubscribers: 0,
      };
    }

    // Calculate MRR growth from trend data (last two points)
    let mrrGrowthRate = 0;
    if (revenueMetrics.trend && revenueMetrics.trend.length >= 2) {
      const lastPoint = revenueMetrics.trend[revenueMetrics.trend.length - 1];
      const previousPoint = revenueMetrics.trend[revenueMetrics.trend.length - 2];
      if (previousPoint.mrr_cents > 0) {
        mrrGrowthRate = ((lastPoint.mrr_cents - previousPoint.mrr_cents) / previousPoint.mrr_cents) * 100;
      }
    }

    // Calculate ARR (Annual Recurring Revenue) = MRR * 12
    const arr = revenueMetrics.mrr_cents * 12;

    // Calculate subscriber counts
    const subscribersByTier = revenueMetrics.subscribers_by_tier || {};
    const totalSubscribers = Object.values(subscribersByTier).reduce((sum, count) => sum + count, 0);
    const paidSubscribers = Object.entries(subscribersByTier)
      .filter(([tier]) => tier !== "free")
      .reduce((sum, [, count]) => sum + count, 0);

    return {
      mrrGrowthRate,
      arr,
      totalSubscribers,
      paidSubscribers,
    };
  }, [revenueMetrics]);

  if (authLoading) {
    return (
      <div className="container py-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="container py-8">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view the analytics dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show error state if critical data failed to load
  if (hasError) {
    const errorMessage = (summaryError || timeSeriesError || revenueError || activityError) as Error;
    return (
      <div className="container py-8">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Failed to Load Analytics
            </CardTitle>
            <CardDescription>
              {errorMessage?.message || "An error occurred while loading analytics data. Please try again later."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => refetchSummary()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleRefresh = () => {
    refetchSummary();
  };

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Platform Analytics</h1>
            <p className="text-muted-foreground">
              Monitor platform usage, revenue, and user activity
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* Total Requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatNumber(usageSummary?.total_requests || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {usageSummary?.unique_api_keys || 0} active API keys
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Active Users */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatNumber(userActivity?.active_users_30d || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {userActivity?.new_signups_month || 0} new this month
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Active MCPs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active MCPs</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatNumber(usageSummary?.unique_mcps || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {usageSummary?.unique_organizations || 0} organizations
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Error Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatPercent(usageSummary?.error_rate || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(usageSummary?.total_errors || 0)} total errors
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* MRR */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MRR</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {revenueLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCents(revenueMetrics?.mrr_cents || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  +{formatCents(revenueMetrics?.overage_revenue_cents || 0)} overage
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="usage" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="revenue" className="gap-2">
            <DollarSign className="h-4 w-4" />
            Revenue
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="top" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Top Entities
          </TabsTrigger>
        </TabsList>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-6">
          {/* Usage Time Series Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Usage Over Time</CardTitle>
              <CardDescription>
                Platform requests, tokens, and errors over the selected period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timeSeriesLoading ? (
                <Skeleton className="h-[350px] w-full" />
              ) : chartData.length > 0 ? (
                <ChartContainer config={usageChartConfig} className="h-[350px] w-full">
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.requests} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={CHART_COLORS.requests} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.tokens} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={CHART_COLORS.tokens} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="timestamp"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatNumber(value)}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      stroke={CHART_COLORS.requests}
                      fillOpacity={1}
                      fill="url(#colorRequests)"
                    />
                    <Area
                      type="monotone"
                      dataKey="errors"
                      stroke={CHART_COLORS.errors}
                      fillOpacity={0.3}
                      fill={CHART_COLORS.errors}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                  No usage data available for this period
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance Metrics */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {usageSummary?.avg_latency_ms || 0}ms
                </div>
                <Progress
                  value={Math.min(100, (usageSummary?.avg_latency_ms || 0) / 5)}
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Target: &lt;500ms
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatNumber(usageSummary?.total_tokens || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Across all organizations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Active API Keys</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatNumber(usageSummary?.unique_api_keys || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  With activity in period
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {/* Growth Metrics Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            {/* MRR */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">MRR</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatCents(revenueMetrics?.mrr_cents || 0)}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {growthMetrics.mrrGrowthRate >= 0 ? (
                        <ArrowUpRight className="h-3 w-3 text-green-600" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-red-600" />
                      )}
                      <span className={`text-xs ${growthMetrics.mrrGrowthRate >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatPercent(Math.abs(growthMetrics.mrrGrowthRate))}
                      </span>
                      <span className="text-xs text-muted-foreground">vs last period</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ARR */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">ARR</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatCents(growthMetrics.arr)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Annual Recurring Revenue
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Overage Revenue */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overage Revenue</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatCents(revenueMetrics?.overage_revenue_cents || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      This month
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Paid Subscribers */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Paid Subscribers</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatNumber(growthMetrics.paidSubscribers)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {growthMetrics.totalSubscribers > 0
                        ? `${formatPercent((growthMetrics.paidSubscribers / growthMetrics.totalSubscribers) * 100)} conversion`
                        : "of total users"}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* MRR Trend Area Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trend</CardTitle>
              <CardDescription>Monthly recurring revenue and overage over time</CardDescription>
            </CardHeader>
            <CardContent>
              {revenueLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : mrrTrendData.length > 0 ? (
                <ChartContainer config={revenueChartConfig} className="h-[300px] w-full">
                  <AreaChart data={mrrTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorMrr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={REVENUE_CHART_COLORS.mrr} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={REVENUE_CHART_COLORS.mrr} stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="colorOverage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={REVENUE_CHART_COLORS.overage} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={REVENUE_CHART_COLORS.overage} stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`}
                    />
                    <ChartTooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="border-border/50 bg-background rounded-lg border px-3 py-2 shadow-xl">
                            <p className="font-medium mb-1">{label}</p>
                            {payload.map((entry, index) => (
                              <div key={index} className="flex items-center justify-between gap-4 text-sm">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: entry.color }}
                                  />
                                  <span className="text-muted-foreground">{entry.name}</span>
                                </div>
                                <span className="font-mono font-medium">
                                  {formatCentsExact((entry.value as number) * 100)}
                                </span>
                              </div>
                            ))}
                            <div className="border-t mt-2 pt-2 flex items-center justify-between text-sm">
                              <span className="font-medium">Total</span>
                              <span className="font-mono font-bold">
                                {formatCentsExact(
                                  payload.reduce((sum, entry) => sum + (entry.value as number) * 100, 0)
                                )}
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      formatter={(value) => (
                        <span className="text-sm text-muted-foreground">{value}</span>
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="mrr"
                      name="MRR"
                      stackId="1"
                      stroke={REVENUE_CHART_COLORS.mrr}
                      fillOpacity={1}
                      fill="url(#colorMrr)"
                    />
                    <Area
                      type="monotone"
                      dataKey="overage"
                      name="Overage"
                      stackId="1"
                      stroke={REVENUE_CHART_COLORS.overage}
                      fillOpacity={1}
                      fill="url(#colorOverage)"
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No revenue trend data available
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Revenue by Tier Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Tier</CardTitle>
                <CardDescription>Revenue distribution across subscription tiers</CardDescription>
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : revenueByTierData.length > 0 ? (
                  <div className="space-y-4">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={revenueByTierData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            paddingAngle={2}
                            dataKey="revenue"
                            label={({ name, percentage }) => `${name} ${percentage.toFixed(1)}%`}
                            labelLine={false}
                          >
                            {revenueByTierData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              return (
                                <div className="border-border/50 bg-background rounded-lg border px-3 py-2 shadow-xl">
                                  <p className="font-medium">{data.name}</p>
                                  <div className="mt-1 space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Revenue:</span>
                                      <span className="font-mono font-medium">{formatCentsExact(data.revenueCents)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Subscribers:</span>
                                      <span className="font-mono">{data.subscribers}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Share:</span>
                                      <span className="font-mono">{formatPercent(data.percentage)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Custom legend below the chart */}
                    <div className="flex flex-wrap justify-center gap-4">
                      {revenueByTierData.map((entry) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.fill }}
                          />
                          <span className="text-sm text-muted-foreground">
                            {entry.name}: <span className="font-medium text-foreground">{formatCents(entry.revenueCents)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No paid subscriptions yet
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Subscription Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Subscription Breakdown</CardTitle>
                <CardDescription>Active subscriptions by tier</CardDescription>
              </CardHeader>
              <CardContent>
                {revenueLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : subscriptionData.length > 0 ? (
                  <div className="space-y-4">
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={subscriptionData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {subscriptionData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [`${value} subscribers`, name]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Custom legend below the chart */}
                    <div className="flex flex-wrap justify-center gap-4">
                      {subscriptionData.map((entry) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.fill }}
                          />
                          <span className="text-sm text-muted-foreground">
                            {entry.name}: <span className="font-medium text-foreground">{entry.value}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No subscription data
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Spend Cap Utilization */}
          <Card>
            <CardHeader>
              <CardTitle>Spend Cap Utilization</CardTitle>
              <CardDescription>
                Organizations with spend caps and their current usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              {capsLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : spendCaps?.caps && spendCaps.caps.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                    <span>{spendCaps.total_with_caps} organizations with caps</span>
                    <span className="text-amber-500">{spendCaps.total_paused} paused</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead className="text-right">Cap</TableHead>
                        <TableHead className="text-right">Current Spend</TableHead>
                        <TableHead className="w-[200px]">Utilization</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {spendCaps.caps.slice(0, 10).map((cap) => (
                        <TableRow key={cap.org_id}>
                          <TableCell className="font-medium">{cap.org_name}</TableCell>
                          <TableCell className="text-right">
                            {formatCents(cap.cap_amount_cents)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCents(cap.current_spend_cents)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress
                                value={Math.min(100, cap.utilization_pct)}
                                className={`h-2 ${
                                  cap.utilization_pct >= 90
                                    ? "[&>div]:bg-red-500"
                                    : cap.utilization_pct >= 75
                                    ? "[&>div]:bg-amber-500"
                                    : "[&>div]:bg-green-500"
                                }`}
                              />
                              <span className="text-xs w-12 text-right">
                                {formatPercent(cap.utilization_pct, 0)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {cap.is_paused ? (
                              <Badge variant="destructive">Paused</Badge>
                            ) : (
                              <Badge variant="outline">Active</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-[100px] flex items-center justify-center text-muted-foreground">
                  No spend caps configured
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {/* DAU */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Daily Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatNumber(userActivity?.active_users_24h || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Last 24 hours
                </p>
              </CardContent>
            </Card>

            {/* WAU */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Weekly Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatNumber(userActivity?.active_users_7d || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Last 7 days
                </p>
              </CardContent>
            </Card>

            {/* MAU */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Monthly Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatNumber(userActivity?.active_users_30d || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Last 30 days
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Signups */}
          <Card>
            <CardHeader>
              <CardTitle>New Signups</CardTitle>
              <CardDescription>User registration trends</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-green-600">
                    +{userActivity?.new_signups_today || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Today</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-blue-600">
                    +{userActivity?.new_signups_week || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">This Week</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-purple-600">
                    +{userActivity?.new_signups_month || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">This Month</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Engagement Metrics */}
          <Card>
            <CardHeader>
              <CardTitle>Engagement Metrics</CardTitle>
              <CardDescription>User retention and stickiness</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">DAU/MAU Ratio (Stickiness)</span>
                    <span className="text-lg font-bold">
                      {userActivity && userActivity.active_users_30d > 0
                        ? formatPercent(
                            (userActivity.active_users_24h / userActivity.active_users_30d) * 100
                          )
                        : "0%"}
                    </span>
                  </div>
                  <Progress
                    value={
                      userActivity && userActivity.active_users_30d > 0
                        ? (userActivity.active_users_24h / userActivity.active_users_30d) * 100
                        : 0
                    }
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Industry benchmark: 10-20% for SaaS
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">WAU/MAU Ratio</span>
                    <span className="text-lg font-bold">
                      {userActivity && userActivity.active_users_30d > 0
                        ? formatPercent(
                            (userActivity.active_users_7d / userActivity.active_users_30d) * 100
                          )
                        : "0%"}
                    </span>
                  </div>
                  <Progress
                    value={
                      userActivity && userActivity.active_users_30d > 0
                        ? (userActivity.active_users_7d / userActivity.active_users_30d) * 100
                        : 0
                    }
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Target: 50-70% for healthy engagement
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Entities Tab */}
        <TabsContent value="top" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top MCPs */}
            <Card>
              <CardHeader>
                <CardTitle>Top MCPs by Usage</CardTitle>
                <CardDescription>Most active MCP instances</CardDescription>
              </CardHeader>
              <CardContent>
                {mcpsLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : topMcps?.mcps && topMcps.mcps.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>MCP</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topMcps.mcps.slice(0, 10).map((mcp, idx) => (
                        <TableRow key={mcp.mcp_id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">#{idx + 1}</span>
                              <span className="font-medium">{mcp.mcp_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {mcp.org_name}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(mcp.request_count)}
                          </TableCell>
                          <TableCell className="text-right">
                            {mcp.error_count > 0 ? (
                              <span className="text-red-500 font-mono">
                                {formatNumber(mcp.error_count)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No MCP usage data
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Organizations */}
            <Card>
              <CardHeader>
                <CardTitle>Top Organizations by Usage</CardTitle>
                <CardDescription>Most active organizations</CardDescription>
              </CardHeader>
              <CardContent>
                {orgsLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : topOrgs?.organizations && topOrgs.organizations.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">MCPs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topOrgs.organizations.slice(0, 10).map((org, idx) => (
                        <TableRow key={org.org_id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">#{idx + 1}</span>
                              <span className="font-medium">{org.org_name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {org.subscription_tier}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(org.request_count)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {org.mcp_count}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No organization usage data
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

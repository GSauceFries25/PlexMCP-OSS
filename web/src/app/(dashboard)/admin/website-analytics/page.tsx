"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  Users,
  Eye,
  Clock,
  TrendingDown,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  RefreshCw,
  Activity,
  ExternalLink,
  Loader2,
  Bot,
  FileText,
  Layers,
  Zap,
  Target,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useWebsiteRealtime,
  useWebsiteOverviewEnhanced,
  useWebsiteTimeseries,
  useWebsiteTopPages,
  useWebsiteReferrers,
  useWebsiteDevices,
  useWebsiteLocations,
  useWebsiteEvents,
  useWebsiteEventDetails,
  useWebsiteGoals,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useWebsiteAlerts,
  useResolveAlert,
} from "@/lib/api/hooks/use-website-analytics";
import { WorldMap } from "@/components/analytics/WorldMap";
import { GoalForm } from "@/components/analytics/GoalForm";
import type { WebsiteGoal, CreateGoalRequest, UpdateGoalRequest } from "@/lib/api/client";

// Time range options
const TIME_RANGES = [
  { value: "today", label: "Today", days: 0 },
  { value: "7d", label: "Last 7 Days", days: 7 },
  { value: "30d", label: "Last 30 Days", days: 30 },
  { value: "90d", label: "Last 90 Days", days: 90 },
];

// Device icons
const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor className="h-4 w-4" />,
  mobile: <Smartphone className="h-4 w-4" />,
  tablet: <Tablet className="h-4 w-4" />,
  bot: <Bot className="h-4 w-4" />,
};

// Device colors
const DEVICE_COLORS: Record<string, string> = {
  desktop: "#3b82f6",
  mobile: "#8b5cf6",
  tablet: "#f59e0b",
  bot: "#6b7280",
};

// Country names mapping
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  RU: "Russia",
  KR: "South Korea",
  IT: "Italy",
  ES: "Spain",
  MX: "Mexico",
  NL: "Netherlands",
  SE: "Sweden",
  CH: "Switzerland",
  PL: "Poland",
  NO: "Norway",
};

// Country flag emoji helper
function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Format helpers
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds === 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatPercent(num: number, decimals = 1): string {
  return `${num.toFixed(decimals)}%`;
}

// Stat card component with change indicator
interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
}

function StatCard({ label, value, change, icon }: StatCardProps) {
  const changeColor = change === undefined || change === 0
    ? "text-muted-foreground"
    : change > 0 ? "text-green-600" : "text-red-500";

  const ChangeIcon = change === undefined || change === 0
    ? Minus
    : change > 0 ? ArrowUp : ArrowDown;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{value}</span>
        {change !== undefined && (
          <span className={`flex items-center text-sm ${changeColor}`}>
            <ChangeIcon className="h-3 w-3" />
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export default function WebsiteAnalyticsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [timeRange, setTimeRange] = useState("30d");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<WebsiteGoal | null>(null);

  // Check if user is an admin
  const isPlatformAdmin = useMemo(() => {
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

  const isReady = !authLoading && isPlatformAdmin;

  // Calculate date range based on selection
  const dateParams = useMemo(() => {
    const range = TIME_RANGES.find((r) => r.value === timeRange) || TIME_RANGES[2];
    const end = new Date();
    // For "Today" (days: 0), use today's date for both start and end
    const start = range.days === 0 ? end : subDays(end, range.days);
    return {
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    };
  }, [timeRange]);

  // Determine granularity for timeseries
  // Use hourly for "Today" (days: 0), daily for everything else
  const granularity = useMemo(() => {
    const range = TIME_RANGES.find((r) => r.value === timeRange);
    return range && range.days === 0 ? "hourly" : "daily";
  }, [timeRange]);

  // Fetch all analytics data
  const { data: realtime, isLoading: realtimeLoading, refetch: refetchRealtime } = useWebsiteRealtime(isReady);
  const { data: overview, isLoading: overviewLoading } = useWebsiteOverviewEnhanced(dateParams, isReady);
  const { data: timeseries, isLoading: timeseriesLoading } = useWebsiteTimeseries(
    { ...dateParams, granularity },
    isReady
  );
  const { data: topPages, isLoading: pagesLoading } = useWebsiteTopPages({ ...dateParams, limit: 10 }, isReady);
  const { data: referrers, isLoading: referrersLoading } = useWebsiteReferrers({ ...dateParams, limit: 10 }, isReady);
  const { data: devices, isLoading: devicesLoading } = useWebsiteDevices(dateParams, isReady);
  const { data: locations, isLoading: locationsLoading } = useWebsiteLocations({ ...dateParams, limit: 20 }, isReady);
  const { data: events, isLoading: eventsLoading } = useWebsiteEvents({ ...dateParams, limit: 20 }, isReady);
  const { data: eventDetails, isLoading: eventDetailsLoading } = useWebsiteEventDetails({ ...dateParams, limit: 20 }, isReady);
  const { data: goals, isLoading: goalsLoading } = useWebsiteGoals(isReady);

  // Goal mutations
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  // Prepare chart data
  const chartData = useMemo(() => {
    return timeseries?.data?.map((point) => ({
      timestamp: format(new Date(point.timestamp), granularity === "hourly" ? "HH:mm" : "MMM dd"),
      visitors: point.visitors,
      sessions: point.sessions,
      page_views: point.page_views,
    })) || [];
  }, [timeseries?.data, granularity]);

  // Prepare device pie chart data
  const deviceData = useMemo(() => {
    return devices?.devices?.map((d) => ({
      name: d.device_type.charAt(0).toUpperCase() + d.device_type.slice(1),
      value: d.count,
      fill: DEVICE_COLORS[d.device_type] || "#6b7280",
    })) || [];
  }, [devices?.devices]);

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
              You do not have permission to view website analytics.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleRefresh = () => {
    refetchRealtime();
  };

  const handleGoalSubmit = async (data: CreateGoalRequest | UpdateGoalRequest) => {
    if (editingGoal) {
      await updateGoal.mutateAsync({ goalId: editingGoal.id, data });
    } else {
      await createGoal.mutateAsync(data as CreateGoalRequest);
    }
    setGoalDialogOpen(false);
    setEditingGoal(null);
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
            <h1 className="text-2xl font-bold">Website Analytics</h1>
            <p className="text-muted-foreground">
              Track visitor activity, pages, and traffic sources
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[150px]">
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

      {/* Realtime Indicator */}
      <Card className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Activity className="h-8 w-8 text-green-500" />
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Live Visitors</div>
                {realtimeLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold text-green-600">
                    {realtime?.active_visitors || 0}
                  </div>
                )}
              </div>
            </div>
            {realtime?.visitors && realtime.visitors.length > 0 && (
              <div className="hidden md:flex gap-2 overflow-x-auto max-w-[400px]">
                {realtime.visitors.slice(0, 5).map((v) => (
                  <Badge key={v.session_id} variant="secondary" className="whitespace-nowrap">
                    {v.country_code && getCountryFlag(v.country_code)}{" "}
                    {v.current_page.length > 20 ? v.current_page.slice(0, 20) + "..." : v.current_page}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Row (Plausible-style) */}
      <Card>
        <CardContent className="py-4">
          {overviewLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-6">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-6">
              <StatCard
                label="Visitors"
                value={formatNumber(overview?.visitors || 0)}
                change={overview?.visitors_change}
                icon={<Users className="h-4 w-4" />}
              />
              <StatCard
                label="Visits"
                value={formatNumber(overview?.sessions || 0)}
                change={overview?.sessions_change}
                icon={<Activity className="h-4 w-4" />}
              />
              <StatCard
                label="Pageviews"
                value={formatNumber(overview?.page_views || 0)}
                change={overview?.page_views_change}
                icon={<Eye className="h-4 w-4" />}
              />
              <StatCard
                label="Views / Visit"
                value={(overview?.views_per_visit || 0).toFixed(1)}
                change={overview?.views_per_visit_change}
                icon={<Layers className="h-4 w-4" />}
              />
              <StatCard
                label="Bounce Rate"
                value={formatPercent(overview?.bounce_rate || 0)}
                change={overview?.bounce_rate_change}
                icon={<TrendingDown className="h-4 w-4" />}
              />
              <StatCard
                label="Visit Duration"
                value={formatDuration(overview?.avg_duration_seconds)}
                change={overview?.duration_change}
                icon={<Clock className="h-4 w-4" />}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time Series Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Visitors</CardTitle>
        </CardHeader>
        <CardContent>
          {timeseriesLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : chartData.length > 0 ? (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
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
                    width={40}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="visitors"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorVisitors)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              No data available for the selected period
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab-based Detail Sections */}
      <Tabs defaultValue="sources" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sources" className="gap-2">
            <ExternalLink className="h-4 w-4" /> Sources
          </TabsTrigger>
          <TabsTrigger value="pages" className="gap-2">
            <FileText className="h-4 w-4" /> Pages
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-2">
            <Globe className="h-4 w-4" /> Locations
          </TabsTrigger>
          <TabsTrigger value="devices" className="gap-2">
            <Monitor className="h-4 w-4" /> Devices
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-2">
            <Zap className="h-4 w-4" /> Events
          </TabsTrigger>
          <TabsTrigger value="goals" className="gap-2">
            <Target className="h-4 w-4" /> Goals
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertCircle className="h-4 w-4" /> Alerts
          </TabsTrigger>
        </TabsList>

        {/* Sources Tab */}
        <TabsContent value="sources">
          <Card>
            <CardHeader>
              <CardTitle>Traffic Sources</CardTitle>
              <CardDescription>Where your visitors are coming from</CardDescription>
            </CardHeader>
            <CardContent>
              {referrersLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : referrers?.sources && referrers.sources.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrers.sources.map((source) => (
                      <TableRow key={source.source}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{source.source}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(source.visitors)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(source.sessions)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No referrer data yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pages Tab */}
        <TabsContent value="pages">
          <Card>
            <CardHeader>
              <CardTitle>Top Pages</CardTitle>
              <CardDescription>Most visited pages on your site</CardDescription>
            </CardHeader>
            <CardContent>
              {pagesLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : topPages?.pages && topPages.pages.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Avg Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topPages.pages.map((page, idx) => (
                      <TableRow key={page.path}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs w-4">
                              {idx + 1}
                            </span>
                            <span className="font-mono text-sm truncate max-w-[300px]">
                              {page.path}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(page.views)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(page.visitors)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDuration(page.avg_time_seconds)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No page data yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations">
          <Card>
            <CardHeader>
              <CardTitle>Locations</CardTitle>
              <CardDescription>Geographic distribution of visitors</CardDescription>
            </CardHeader>
            <CardContent>
              {locationsLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : locations?.locations && locations.locations.length > 0 ? (
                <div className="space-y-4">
                  {/* World Map */}
                  <div className="h-[300px] w-full rounded-lg border bg-muted/50">
                    <WorldMap locations={locations.locations} className="h-full w-full" />
                  </div>

                  {/* Country List below map */}
                  <div className="space-y-2">
                    {locations.locations.slice(0, 10).map((loc) => (
                      <div key={loc.country_code} className="flex items-center gap-3">
                        <span className="text-2xl w-8">
                          {getCountryFlag(loc.country_code)}
                        </span>
                        <span className="flex-1 font-medium">
                          {COUNTRY_NAMES[loc.country_code] || loc.country_code}
                        </span>
                        <div className="flex-1">
                          <Progress value={loc.percentage} className="h-2" />
                        </div>
                        <span className="font-mono text-sm w-16 text-right">
                          {formatNumber(loc.visitors)}
                        </span>
                        <span className="text-muted-foreground text-sm w-12 text-right">
                          {formatPercent(loc.percentage, 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No location data yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices">
          <Card>
            <CardHeader>
              <CardTitle>Devices</CardTitle>
              <CardDescription>Visitor device types</CardDescription>
            </CardHeader>
            <CardContent>
              {devicesLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : devices?.devices && devices.devices.length > 0 ? (
                <div className="flex items-center gap-8">
                  <div className="w-[180px] h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={deviceData}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {deviceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-3">
                    {devices.devices.map((device) => (
                      <div key={device.device_type} className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: DEVICE_COLORS[device.device_type] || "#6b7280" }}
                        />
                        {DEVICE_ICONS[device.device_type] || <Monitor className="h-4 w-4" />}
                        <span className="capitalize flex-1">{device.device_type}</span>
                        <span className="font-mono text-sm">{formatNumber(device.count)}</span>
                        <span className="text-muted-foreground text-sm w-12 text-right">
                          {formatPercent(device.percentage, 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No device data yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Event Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle>Event Summary</CardTitle>
                <CardDescription>Custom events tracked {TIME_RANGES.find(r => r.value === timeRange)?.label.toLowerCase() || "in the selected period"}</CardDescription>
              </CardHeader>
              <CardContent>
                {eventsLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : events?.events && events.events.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-medium font-mono text-sm">
                            {event.event_name}
                          </TableCell>
                          <TableCell>
                            {event.event_category ? (
                              <Badge variant="outline">{event.event_category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(event.count)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No custom events tracked yet
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Events Card */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Events</CardTitle>
                <CardDescription>Latest custom event activity</CardDescription>
              </CardHeader>
              <CardContent>
                {eventDetailsLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : eventDetails?.events && eventDetails.events.length > 0 ? (
                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                    {eventDetails.events.map((event) => (
                      <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <Zap className="h-4 w-4 text-amber-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium font-mono text-sm">
                              {event.event_name}
                            </span>
                            {event.event_category && (
                              <Badge variant="secondary" className="text-xs">
                                {event.event_category}
                              </Badge>
                            )}
                          </div>
                          {event.page_url && (
                            <div className="text-xs text-muted-foreground truncate">
                              {event.page_url}
                            </div>
                          )}
                          {event.event_data && Object.keys(event.event_data).length > 0 && (
                            <pre className="text-xs text-muted-foreground mt-1 p-2 bg-muted rounded overflow-x-auto">
                              {JSON.stringify(event.event_data, null, 2)}
                            </pre>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(event.created_at), "MMM dd HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No recent events
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Goals Tab */}
        <TabsContent value="goals">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Conversion Goals</CardTitle>
                <CardDescription>Track and measure important user actions</CardDescription>
              </div>
              <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => setEditingGoal(null)}>
                    <Plus className="h-4 w-4 mr-2" /> Add Goal
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <GoalForm
                    goal={editingGoal}
                    onSubmit={handleGoalSubmit}
                    onCancel={() => {
                      setGoalDialogOpen(false);
                      setEditingGoal(null);
                    }}
                  />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {goalsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : goals?.goals && goals.goals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goals.goals.map((goal) => (
                      <TableRow key={goal.id}>
                        <TableCell>
                          <div className="font-medium">{goal.name}</div>
                          {goal.description && (
                            <div className="text-xs text-muted-foreground">
                              {goal.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {goal.goal_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {goal.event_name && `event: ${goal.event_name}`}
                          {goal.url_pattern && `url: ${goal.url_pattern}`}
                          {goal.min_duration_seconds && `duration: ${goal.min_duration_seconds}s`}
                          {goal.min_page_views && `pages: ${goal.min_page_views}+`}
                        </TableCell>
                        <TableCell>
                          {goal.is_active ? (
                            <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                              <Check className="h-3 w-3 mr-1" /> Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <X className="h-3 w-3 mr-1" /> Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingGoal(goal);
                                setGoalDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => deleteGoal.mutate(goal.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
                  <Target className="h-12 w-12 mb-4 opacity-50" />
                  <p>No goals configured yet</p>
                  <p className="text-sm">Create a goal to track important conversions</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Alerts Tab Component
// =============================================================================

function AlertsTab() {
  const { data: alertsData, isLoading } = useWebsiteAlerts({ is_resolved: false });
  const resolveAlert = useResolveAlert();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleResolve = async (alertId: string) => {
    setResolvingId(alertId);
    try {
      await resolveAlert.mutateAsync({
        alertId,
        resolution_note: "Resolved from dashboard",
      });
    } catch (error) {
      // Consider showing a toast notification here
      console.error("Failed to resolve alert:", error);
    } finally {
      setResolvingId(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Traffic Alerts</CardTitle>
          <CardDescription>Real-time notifications for traffic spikes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const alerts = alertsData?.alerts || [];
  const hasAlerts = alerts.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic Alerts</CardTitle>
        <CardDescription>
          Real-time notifications for unusual traffic patterns
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasAlerts ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alert</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Triggered</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                      <div>
                        <div className="font-medium">{alert.alert_type.replace(/_/g, " ")}</div>
                        <div className="text-sm text-muted-foreground">
                          {alert.baseline_value && alert.baseline_value > 0
                            ? `${(alert.current_value / alert.baseline_value).toFixed(1)}x baseline traffic`
                            : alert.current_value
                            ? `${alert.current_value} (no baseline)`
                            : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        alert.severity === "high"
                          ? "destructive"
                          : alert.severity === "medium"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {alert.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{alert.metric_name}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{alert.current_value}</span>
                  </TableCell>
                  <TableCell>{alert.baseline_value}</TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(alert.triggered_at), "MMM d, HH:mm")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResolve(alert.id)}
                      disabled={resolvingId === alert.id}
                    >
                      {resolvingId === alert.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      <span className="ml-2">Resolve</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
            <p>No active alerts</p>
            <p className="text-sm">Traffic is within normal parameters</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { format, formatDistanceToNow, isValid } from "date-fns";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Users,
  Server,
  KeyRound,
  Activity,
  Crown,
  Loader2,
  AlertCircle,
  ShieldX,
  RefreshCw,
  CreditCard,
  DollarSign,
  History,
  RotateCcw,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  useAdminOrganization,
  useAdminOrgLimits,
  useAdminSetOrgLimits,
  useAdminClearOrgLimits,
  useAdminLimitHistory,
} from "@/lib/api/hooks/use-admin";
import type { SetCustomLimitsRequest } from "@/lib/api/client";

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

// Tier badge colors
const TIER_COLORS: Record<string, string> = {
  free: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  team: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  enterprise: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// Status badge colors
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  trialing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  canceled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  past_due: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// Tier limits
const TIER_LIMITS: Record<string, { requests: number; mcps: number; apiKeys: number; members: number }> = {
  free: { requests: 1000, mcps: 2, apiKeys: 3, members: 1 },
  pro: { requests: 50000, mcps: 10, apiKeys: 10, members: 5 },
  team: { requests: 500000, mcps: 50, apiKeys: 50, members: 25 },
  enterprise: { requests: -1, mcps: -1, apiKeys: -1, members: -1 }, // Unlimited
};

// Enterprise Limits Content Component
function EnterpriseLimitsContent({ orgId }: { orgId: string }) {
  const [formData, setFormData] = useState<SetCustomLimitsRequest>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: limitsData, isLoading, error } = useAdminOrgLimits(orgId);
  const { data: historyData, isLoading: historyLoading } = useAdminLimitHistory(orgId, 1, 10);

  const setLimitsMutation = useAdminSetOrgLimits();
  const clearLimitsMutation = useAdminClearOrgLimits();

  useEffect(() => {
    if (limitsData) {
      setFormData({
        max_mcps: limitsData.custom_limits.max_mcps,
        max_api_keys: limitsData.custom_limits.max_api_keys,
        max_team_members: limitsData.custom_limits.max_team_members,
        max_requests_monthly: limitsData.custom_limits.max_requests_monthly,
        overage_rate_cents: limitsData.custom_limits.overage_rate_cents,
        monthly_price_cents: limitsData.custom_limits.monthly_price_cents,
        notes: limitsData.notes,
      });
      setHasChanges(false);
    }
  }, [limitsData]);

  const handleFieldChange = (field: keyof SetCustomLimitsRequest, value: string | null) => {
    let parsedValue: number | null = null;
    if (value !== null && value !== "") {
      parsedValue = parseInt(value);
      if (isNaN(parsedValue)) parsedValue = null;
    }
    setFormData(prev => ({ ...prev, [field]: parsedValue }));
    setHasChanges(true);
  };

  const handleNotesChange = (value: string) => {
    setFormData(prev => ({ ...prev, notes: value || null }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await setLimitsMutation.mutateAsync({ orgId, data: formData });
      toast.success("Custom limits saved");
      setHasChanges(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save limits");
    }
  };

  const handleReset = async () => {
    try {
      await clearLimitsMutation.mutateAsync(orgId);
      toast.success("Custom limits cleared - using tier defaults");
      setFormData({});
      setHasChanges(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear limits");
    }
  };

  const handleSetUnlimited = () => {
    const UNLIMITED = 2147483647;
    setFormData(prev => ({
      ...prev,
      max_mcps: UNLIMITED,
      max_api_keys: UNLIMITED,
      max_team_members: UNLIMITED,
      max_requests_monthly: Number.MAX_SAFE_INTEGER,
    }));
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !limitsData) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <p className="text-neutral-500">Failed to load enterprise limits</p>
      </div>
    );
  }

  const formatPrice = (cents: number | null | undefined): string => {
    if (cents === null || cents === undefined) return "Not set";
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <Card className="border-orange-200 dark:border-orange-900">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2 text-orange-600">
                <Crown className="h-4 w-4" />
                Enterprise Custom Limits
              </CardTitle>
              <CardDescription>
                Custom limits override tier defaults. Leave empty to use tier defaults.
              </CardDescription>
            </div>
            {limitsData.effective_limits.source !== "tier" && (
              <Badge variant="outline" className="text-orange-600 border-orange-300">
                Custom Limits Active
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Max MCPs</label>
              <p className="text-xs text-neutral-500">Tier: {limitsData.tier_limits.max_mcps >= 2147483647 ? "Unlimited" : limitsData.tier_limits.max_mcps}</p>
              <Input
                type="number"
                placeholder="Use tier default"
                value={formData.max_mcps ?? ""}
                onChange={(e) => handleFieldChange("max_mcps", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Max API Keys</label>
              <p className="text-xs text-neutral-500">Tier: {limitsData.tier_limits.max_api_keys >= 2147483647 ? "Unlimited" : limitsData.tier_limits.max_api_keys}</p>
              <Input
                type="number"
                placeholder="Use tier default"
                value={formData.max_api_keys ?? ""}
                onChange={(e) => handleFieldChange("max_api_keys", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Max Team Members</label>
              <p className="text-xs text-neutral-500">Tier: {limitsData.tier_limits.max_team_members >= 2147483647 ? "Unlimited" : limitsData.tier_limits.max_team_members}</p>
              <Input
                type="number"
                placeholder="Use tier default"
                value={formData.max_team_members ?? ""}
                onChange={(e) => handleFieldChange("max_team_members", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Max Monthly Requests</label>
              <p className="text-xs text-neutral-500">Tier: {limitsData.tier_limits.max_requests_monthly >= Number.MAX_SAFE_INTEGER ? "Unlimited" : limitsData.tier_limits.max_requests_monthly.toLocaleString()}</p>
              <Input
                type="number"
                placeholder="Use tier default"
                value={formData.max_requests_monthly ?? ""}
                onChange={(e) => handleFieldChange("max_requests_monthly", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Overage Rate (cents/1K)</label>
              <p className="text-xs text-neutral-500">Tier: {formatPrice(limitsData.tier_limits.overage_rate_cents)}</p>
              <Input
                type="number"
                placeholder="Use tier default"
                value={formData.overage_rate_cents ?? ""}
                onChange={(e) => handleFieldChange("overage_rate_cents", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Monthly Price (cents)</label>
              <p className="text-xs text-neutral-500">Custom subscription price</p>
              <Input
                type="number"
                placeholder="Use Stripe price"
                value={formData.monthly_price_cents ?? ""}
                onChange={(e) => handleFieldChange("monthly_price_cents", e.target.value || null)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <label className="text-sm font-medium">Contract Notes</label>
            <Textarea
              placeholder="Add notes about the enterprise agreement..."
              value={formData.notes ?? ""}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={3}
            />
          </div>

          {limitsData.updated_at && (
            <p className="text-xs text-neutral-500">
              Last updated: {safeFormatDistanceToNow(limitsData.updated_at)}
              {limitsData.updated_by && ` by ${limitsData.updated_by.email}`}
            </p>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSetUnlimited}>
                Set All Unlimited
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset to Defaults
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset to Tier Defaults?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will clear all custom limits for this organization. They will use the standard Enterprise tier limits.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-red-600 hover:bg-red-700">
                      {clearLimitsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Reset Limits
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || setLimitsMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {setLimitsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Effective Limits Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Effective Limits</CardTitle>
          <CardDescription>
            Currently applied limits for this organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-neutral-500">MCPs:</span>
              <p className="font-medium">{limitsData.effective_limits.max_mcps >= 2147483647 ? "Unlimited" : limitsData.effective_limits.max_mcps}</p>
            </div>
            <div>
              <span className="text-neutral-500">API Keys:</span>
              <p className="font-medium">{limitsData.effective_limits.max_api_keys >= 2147483647 ? "Unlimited" : limitsData.effective_limits.max_api_keys}</p>
            </div>
            <div>
              <span className="text-neutral-500">Team Members:</span>
              <p className="font-medium">{limitsData.effective_limits.max_team_members >= 2147483647 ? "Unlimited" : limitsData.effective_limits.max_team_members}</p>
            </div>
            <div>
              <span className="text-neutral-500">Monthly Requests:</span>
              <p className="font-medium">{limitsData.effective_limits.max_requests_monthly >= Number.MAX_SAFE_INTEGER ? "Unlimited" : limitsData.effective_limits.max_requests_monthly.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-neutral-500">Overage Rate:</span>
              <p className="font-medium">{formatPrice(limitsData.effective_limits.overage_rate_cents)}/1K</p>
            </div>
            <div>
              <span className="text-neutral-500">Source:</span>
              <Badge variant="outline" className={
                limitsData.effective_limits.source === "custom" ? "text-orange-600" :
                limitsData.effective_limits.source === "mixed" ? "text-blue-600" : "text-neutral-600"
              }>
                {limitsData.effective_limits.source}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-32">
            {historyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            ) : !historyData?.changes?.length ? (
              <p className="text-sm text-neutral-500">No changes recorded</p>
            ) : (
              <div className="space-y-2">
                {historyData.changes.map((change) => (
                  <div key={change.id} className="text-xs p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{change.changed_by.email}</span>
                      <span className="text-neutral-400">{safeFormatDistanceToNow(change.created_at)}</span>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400">
                      {change.change_type === "set" && `Set ${change.field_name}: ${change.new_value}`}
                      {change.change_type === "update" && `Updated ${change.field_name}: ${change.old_value} -> ${change.new_value}`}
                      {change.change_type === "remove" && `Removed ${change.field_name}${change.field_name === "all" ? " (reset to defaults)" : ""}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OrganizationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params.orgId as string;
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState("overview");

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

  // Fetch organization data
  const { data: orgData, isLoading: orgLoading, error: orgError, refetch } = useAdminOrganization(orgId, !authLoading && isAdmin);

  // Fetch org limits for stats (works for all tiers)
  const { data: limitsData } = useAdminOrgLimits(orgId, !authLoading && isAdmin);

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

  // Derived values
  const tier = orgData?.subscription_tier || "free";
  const tierLimits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const isEnterprise = tier === "enterprise";

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link href="/admin/organizations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Organizations
          </Button>
        </Link>
      </div>

      {/* Loading State */}
      {orgLoading ? (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : orgError ? (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">Failed to Load Organization</h3>
          <p className="text-neutral-500 mb-4">{(orgError as Error).message}</p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      ) : orgData ? (
        <>
          {/* Page Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Building2 className="h-8 w-8 text-neutral-400" />
              <h1 className="text-2xl font-bold">{orgData.name}</h1>
              <Badge variant="secondary" className={TIER_COLORS[tier]}>
                {isEnterprise && <Crown className="h-3 w-3 mr-1" />}
                {tier}
              </Badge>
              <Badge variant="secondary" className={STATUS_COLORS[orgData.subscription_status || "none"]}>
                {orgData.subscription_status || "none"}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500">
              Created {safeFormatDistanceToNow(orgData.created_at)}
            </p>
          </div>

          {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">Team Members</span>
                </div>
                <p className="text-2xl font-bold">
                  {limitsData?.effective_limits?.max_team_members
                    ? limitsData.effective_limits.max_team_members >= 2147483647
                      ? "Unlimited"
                      : `0 / ${limitsData.effective_limits.max_team_members}`
                    : tierLimits.members === -1
                      ? "Unlimited"
                      : `0 / ${tierLimits.members}`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">MCPs</span>
                </div>
                <p className="text-2xl font-bold">
                  {limitsData?.effective_limits?.max_mcps
                    ? limitsData.effective_limits.max_mcps >= 2147483647
                      ? "Unlimited"
                      : `0 / ${limitsData.effective_limits.max_mcps}`
                    : tierLimits.mcps === -1
                      ? "Unlimited"
                      : `0 / ${tierLimits.mcps}`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <KeyRound className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">API Keys</span>
                </div>
                <p className="text-2xl font-bold">
                  {limitsData?.effective_limits?.max_api_keys
                    ? limitsData.effective_limits.max_api_keys >= 2147483647
                      ? "Unlimited"
                      : `0 / ${limitsData.effective_limits.max_api_keys}`
                    : tierLimits.apiKeys === -1
                      ? "Unlimited"
                      : `0 / ${tierLimits.apiKeys}`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">Monthly Requests</span>
                </div>
                <p className="text-2xl font-bold">
                  {limitsData?.effective_limits?.max_requests_monthly
                    ? limitsData.effective_limits.max_requests_monthly >= Number.MAX_SAFE_INTEGER
                      ? "Unlimited"
                      : `0 / ${limitsData.effective_limits.max_requests_monthly.toLocaleString()}`
                    : tierLimits.requests === -1
                      ? "Unlimited"
                      : `0 / ${tierLimits.requests.toLocaleString()}`}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className={`grid w-full max-w-[600px] ${isEnterprise ? "grid-cols-5" : "grid-cols-4"}`}>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="mcps">MCPs</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
              {isEnterprise && (
                <TabsTrigger value="enterprise" className="text-orange-600">Enterprise</TabsTrigger>
              )}
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Organization Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Organization Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Organization ID</span>
                      <p className="font-mono text-xs">{orgData.id}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Slug</span>
                      <p className="font-medium">{orgData.slug}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Created</span>
                      <p className="font-medium">{safeFormatDate(orgData.created_at, "MMMM d, yyyy")}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Last Updated</span>
                      <p className="font-medium">{safeFormatDate(orgData.updated_at, "MMMM d, yyyy")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Subscription Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Subscription Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Tier</span>
                      <div className="mt-1">
                        <Badge variant="secondary" className={TIER_COLORS[tier]}>
                          {isEnterprise && <Crown className="h-3 w-3 mr-1" />}
                          {tier}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-neutral-500">Status</span>
                      <div className="mt-1">
                        <Badge variant="secondary" className={STATUS_COLORS[orgData.subscription_status || "none"]}>
                          {orgData.subscription_status === "active" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {orgData.subscription_status === "trialing" && <Clock className="h-3 w-3 mr-1" />}
                          {orgData.subscription_status || "none"}
                        </Badge>
                      </div>
                    </div>
                    {orgData.stripe_customer_id && (
                      <div>
                        <span className="text-neutral-500">Stripe Customer ID</span>
                        <p className="font-mono text-xs">{orgData.stripe_customer_id}</p>
                      </div>
                    )}
                    {orgData.stripe_subscription_id && (
                      <div>
                        <span className="text-neutral-500">Stripe Subscription ID</span>
                        <p className="font-mono text-xs">{orgData.stripe_subscription_id}</p>
                      </div>
                    )}
                    {orgData.trial_ends_at && (
                      <div>
                        <span className="text-neutral-500">Trial Ends</span>
                        <p className="font-medium">{safeFormatDate(orgData.trial_ends_at, "MMMM d, yyyy")}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Usage Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Usage Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Monthly API Requests</span>
                      <span>
                        {limitsData?.effective_limits?.max_requests_monthly &&
                        limitsData.effective_limits.max_requests_monthly < Number.MAX_SAFE_INTEGER
                          ? `0 / ${limitsData.effective_limits.max_requests_monthly.toLocaleString()}`
                          : "Unlimited"}
                      </span>
                    </div>
                    <Progress value={0} className="h-2" />
                    <p className="text-xs text-neutral-500">0% of monthly limit used</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Team Members
                  </CardTitle>
                  <CardDescription>
                    Organization members and their roles
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-500 text-center py-8">
                    Member data is not available from the admin API. View users in the Users section.
                  </p>
                  <div className="flex justify-center">
                    <Link href="/admin/users">
                      <Button variant="outline">
                        View All Users
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MCPs Tab */}
            <TabsContent value="mcps" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    MCP Instances
                  </CardTitle>
                  <CardDescription>
                    MCP servers for this organization
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-500 text-center py-8">
                    MCP data is not available from the admin API. Contact engineering for MCP management.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Billing Tab */}
            <TabsContent value="billing" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Billing Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Subscription Tier</span>
                      <div className="mt-1">
                        <Badge variant="secondary" className={TIER_COLORS[tier]}>
                          {tier}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-neutral-500">Subscription Status</span>
                      <div className="mt-1">
                        <Badge variant="secondary" className={STATUS_COLORS[orgData.subscription_status || "none"]}>
                          {orgData.subscription_status || "none"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {orgData.stripe_customer_id ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Stripe Details</p>
                      <div className="text-sm space-y-1">
                        <p><span className="text-neutral-500">Customer ID:</span> <span className="font-mono">{orgData.stripe_customer_id}</span></p>
                        {orgData.stripe_subscription_id && (
                          <p><span className="text-neutral-500">Subscription ID:</span> <span className="font-mono">{orgData.stripe_subscription_id}</span></p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-500">No Stripe customer connected</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Recent Invoices
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-500 text-center py-8">
                    Invoice data is not available from the admin API. Use Stripe Dashboard for billing details.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Enterprise Tab */}
            {isEnterprise && (
              <TabsContent value="enterprise" className="space-y-6 mt-6">
                <EnterpriseLimitsContent orgId={orgData.id} />
              </TabsContent>
            )}
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

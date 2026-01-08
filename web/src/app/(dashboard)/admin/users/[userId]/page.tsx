"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { format, formatDistanceToNow, isValid, parseISO, differenceInDays } from "date-fns";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Activity,
  Shield,
  Crown,
  Star,
  User as UserIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Globe,
  Key,
  Clock,
  LogOut,
  RotateCcw,
  ShieldOff,
  Ban,
  Trash2,
  ShieldAlert,
  History,
  Smartphone,
  Mail,
  KeyRound,
  ShieldX,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
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
  useAdminUser,
  useAdminUpdateUser,
  useAdminSetUsage,
  useAdminResetUsage,
  useAdminRevokeUserSessions,
  useAdminForcePasswordReset,
  useAdminDisable2FA,
  useAdminSuspendUser,
  useAdminUnsuspendUser,
  useAdminDeleteUser,
  useAdminRevokeApiKey,
  useAdminOrgLimits,
  useAdminSetOrgLimits,
  useAdminClearOrgLimits,
  useAdminLimitHistory,
  useAdminOrgOverages,
  useAdminToggleOrgOverages,
} from "@/lib/api/hooks/use-admin";
import type { SetCustomLimitsRequest } from "@/lib/api/client";
import { TierChangeModal } from "@/components/admin/TierChangeModal";
import { TrialInfoBanner } from "@/components/admin/TrialInfoBanner";

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

// Role badge colors
const ROLE_COLORS: Record<string, string> = {
  user: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  staff: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  superadmin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// Tier badge colors
const TIER_COLORS: Record<string, string> = {
  free: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  team: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  enterprise: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// Role icons
const ROLE_ICONS: Record<string, React.ReactNode> = {
  user: <UserIcon className="h-3 w-3" />,
  staff: <Shield className="h-3 w-3" />,
  admin: <Star className="h-3 w-3" />,
  superadmin: <Crown className="h-3 w-3" />,
};

// Tier limits
const TIER_LIMITS: Record<string, number> = {
  free: 1000,
  pro: 50000,
  team: 500000,
  enterprise: -1, // Unlimited
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
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Organization: {limitsData.org_name}</span>
                <br />
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

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.userId as string;
  const { user, loading: authLoading } = useAuth();

  const [newRole, setNewRole] = useState<string>("");
  const [newTier, setNewTier] = useState<string>("");
  const [newUsage, setNewUsage] = useState<string>("");
  const [suspendReason, setSuspendReason] = useState<string>("");
  const [activeTab, setActiveTab] = useState("overview");
  const [tierModalOpen, setTierModalOpen] = useState(false);

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

  // Fetch user data
  const { data: userData, isLoading: userLoading, error: userError, refetch } = useAdminUser(userId);

  // Mutations
  const updateUser = useAdminUpdateUser();
  const setUsage = useAdminSetUsage();
  const resetUsage = useAdminResetUsage();
  const revokeSessionsMutation = useAdminRevokeUserSessions();
  const forcePasswordResetMutation = useAdminForcePasswordReset();
  const disable2FAMutation = useAdminDisable2FA();
  const suspendMutation = useAdminSuspendUser();
  const unsuspendMutation = useAdminUnsuspendUser();
  const deleteMutation = useAdminDeleteUser();
  const revokeApiKeyMutation = useAdminRevokeApiKey();
  const toggleOveragesMutation = useAdminToggleOrgOverages();

  // Fetch overages status when org_id is available
  const { data: overagesData, refetch: refetchOverages } = useAdminOrgOverages(
    userData?.org_id || "",
    !!userData?.org_id
  );

  const [overagesReason, setOveragesReason] = useState("");

  const handleRoleChange = async () => {
    if (!newRole) return;
    try {
      await updateUser.mutateAsync({
        userId,
        data: { platform_role: newRole as "user" | "staff" | "admin" | "superadmin" },
      });
      toast.success(`Role updated to ${newRole}`);
      setNewRole("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    }
  };

  const handleTierChange = async () => {
    if (!newTier) return;
    try {
      await updateUser.mutateAsync({
        userId,
        data: { subscription_tier: newTier },
      });
      toast.success(`Tier updated to ${newTier}`);
      setNewTier("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tier");
    }
  };

  const handleSetUsage = async () => {
    if (!userData) return;
    const count = parseInt(newUsage);
    if (isNaN(count) || count < 0) {
      toast.error("Please enter a valid number");
      return;
    }
    try {
      await setUsage.mutateAsync({
        org_id: userData.org_id,
        request_count: count,
      });
      toast.success(`Usage set to ${count.toLocaleString()}`);
      setNewUsage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to set usage");
    }
  };

  const handleResetUsage = async () => {
    if (!userData) return;
    try {
      await resetUsage.mutateAsync(userData.org_id);
      toast.success("Usage reset to 0");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset usage");
    }
  };

  const handleRevokeSessions = async () => {
    try {
      const result = await revokeSessionsMutation.mutateAsync(userId);
      toast.success(`Revoked ${result.sessions_revoked} sessions`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke sessions");
    }
  };

  const handleForcePasswordReset = async () => {
    try {
      await forcePasswordResetMutation.mutateAsync(userId);
      toast.success("Password reset required on next login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to force password reset");
    }
  };

  const handleDisable2FA = async () => {
    try {
      const result = await disable2FAMutation.mutateAsync(userId);
      toast.success(`2FA disabled. Deleted ${result.backup_codes_deleted} backup codes and ${result.trusted_devices_deleted} trusted devices.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disable 2FA");
    }
  };

  const handleSuspend = async () => {
    try {
      await suspendMutation.mutateAsync({ userId, reason: suspendReason || undefined });
      toast.success("User account suspended");
      setSuspendReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to suspend user");
    }
  };

  const handleUnsuspend = async () => {
    try {
      await unsuspendMutation.mutateAsync(userId);
      toast.success("User account unsuspended");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unsuspend user");
    }
  };

  const handleDeleteUser = async () => {
    try {
      await deleteMutation.mutateAsync(userId);
      toast.success("User deleted permanently");
      router.push("/admin/users");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete user");
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    try {
      await revokeApiKeyMutation.mutateAsync({ userId, keyId });
      toast.success("API key revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke API key");
    }
  };

  const handleToggleOverages = async (disable: boolean) => {
    if (!userData?.org_id) return;
    try {
      await toggleOveragesMutation.mutateAsync({
        orgId: userData.org_id,
        data: {
          disable_overages: disable,
          reason: overagesReason || undefined,
        },
      });
      toast.success(disable ? "Overages disabled" : "Overages enabled");
      setOveragesReason("");
      refetchOverages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle overages");
    }
  };

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
  const tierLimit = userData ? TIER_LIMITS[userData.subscription_tier || "free"] : 0;
  const limitDisplay = tierLimit === -1 ? "Unlimited" : tierLimit.toLocaleString();

  // Default values for when backend hasn't been updated yet
  const security = userData?.security || {
    two_factor_enabled: false,
    two_factor_enabled_at: null,
    two_factor_last_used: null,
    has_backup_codes: false,
    backup_codes_remaining: 0,
  };
  const sessions = userData?.sessions || [];
  const loginHistory = userData?.login_history || [];
  const oauthProviders = userData?.oauth_providers || [];
  const trustedDevices = userData?.trusted_devices || [];
  const apiKeys = userData?.api_keys || {
    total_count: 0,
    active_count: 0,
    total_requests: 0,
    keys: [],
  };
  const isSuspended = userData?.is_suspended ?? false;
  const suspendedAt = userData?.suspended_at ?? null;
  const suspendedReason = userData?.suspended_reason ?? null;
  const passwordChangedAt = userData?.password_changed_at ?? null;

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link href="/admin/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
        </Link>
      </div>

      {/* Loading State */}
      {userLoading ? (
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
      ) : userError ? (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">Failed to Load User</h3>
          <p className="text-neutral-500 mb-4">{(userError as Error).message}</p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      ) : userData ? (
        <>
          {/* Page Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{userData.email}</h1>
              <Badge variant="secondary" className={ROLE_COLORS[userData.platform_role || "user"]}>
                {ROLE_ICONS[userData.platform_role || "user"]}
                <span className="ml-1">{userData.platform_role || "user"}</span>
              </Badge>
              {userData.is_suspended && (
                <Badge variant="destructive">
                  <Ban className="h-3 w-3 mr-1" />
                  Suspended
                </Badge>
              )}
            </div>
            <p className="text-sm text-neutral-500">
              Joined {safeFormatDistanceToNow(userData.created_at)}
            </p>
          </div>

          {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">Organization</span>
                </div>
                <p className="font-medium">{userData.org_name}</p>
                <Badge variant="secondary" className={`mt-1 ${TIER_COLORS[userData.subscription_tier || "free"]}`}>
                  {userData.subscription_tier || "free"}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">Last Login</span>
                </div>
                <p className="font-medium">
                  {userData.last_login_at ? safeFormatDistanceToNow(userData.last_login_at) : "Never"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <KeyRound className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">API Keys</span>
                </div>
                <p className="font-medium">{apiKeys.active_count} active</p>
                <p className="text-xs text-neutral-500">{apiKeys.total_requests.toLocaleString()} total requests</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-500">Email Verification</span>
                </div>
                <div className="flex items-center gap-2">
                  {userData.email_verified ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-green-600">Verified</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-red-600">Not verified</span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className={`grid w-full max-w-[600px] ${userData.subscription_tier === "enterprise" ? "grid-cols-5" : "grid-cols-4"}`}>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="apikeys">API Keys</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              {userData.subscription_tier === "enterprise" && (
                <TabsTrigger value="enterprise" className="text-orange-600">Enterprise</TabsTrigger>
              )}
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Trial Information Banner */}
              {userData.trial_end && (
                <TrialInfoBanner
                  trialStart={userData.trial_start!}
                  trialEnd={userData.trial_end}
                  adminGranted={userData.admin_trial_granted}
                  adminReason={userData.admin_trial_reason}
                  grantedAt={userData.admin_trial_granted_at}
                />
              )}

              {/* Scheduled Tier Change */}
              {userData.scheduled_downgrade && (
                <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                      <Clock className="h-5 w-5" />
                      Scheduled Tier Change
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-blue-700 dark:text-blue-300">Current Tier:</span>
                        <Badge className="bg-blue-600">{userData.scheduled_downgrade.current_tier}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-blue-700 dark:text-blue-300">Scheduled To:</span>
                        <Badge variant="outline">{userData.scheduled_downgrade.new_tier}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-blue-700 dark:text-blue-300">Effective Date:</span>
                        <span className="text-sm text-blue-800 dark:text-blue-200">
                          {safeFormatDate(userData.scheduled_downgrade.effective_date, "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      {userData.scheduled_downgrade.admin_email && (
                        <div className="flex justify-between">
                          <span className="text-sm text-blue-700 dark:text-blue-300">Scheduled By:</span>
                          <span className="text-sm text-blue-800 dark:text-blue-200">{userData.scheduled_downgrade.admin_email}</span>
                        </div>
                      )}
                      {userData.scheduled_downgrade.reason && (
                        <div className="mt-2 p-2 bg-blue-100 dark:bg-blue-900 rounded text-sm">
                          <span className="font-medium text-blue-800 dark:text-blue-200">Reason:</span>{" "}
                          <span className="text-blue-700 dark:text-blue-300">{userData.scheduled_downgrade.reason}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Usage Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Usage Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>API Requests</span>
                    <span className="font-medium">
                      {userData.usage.requests_used.toLocaleString()} / {limitDisplay}
                    </span>
                  </div>
                  <Progress value={Math.min(userData.usage.percentage_used, 100)} className="h-2" />
                  <p className="text-xs text-neutral-500">
                    {userData.usage.percentage_used.toFixed(1)}% of monthly limit used
                    {userData.usage.is_over_limit && (
                      <span className="text-red-500 ml-2">(Over limit!)</span>
                    )}
                  </p>

                  <Separator />

                  {/* Usage Management */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Usage Management</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Set request count..."
                        value={newUsage}
                        onChange={(e) => setNewUsage(e.target.value)}
                        min={0}
                        className="flex-1"
                      />
                      <Button onClick={handleSetUsage} disabled={!newUsage || setUsage.isPending} size="sm">
                        {setUsage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[0, 500, 995, 1000, 1500, 5000].map((val) => (
                        <Button key={val} variant="outline" size="sm" onClick={() => setNewUsage(val.toString())}>
                          {val.toLocaleString()}
                        </Button>
                      ))}
                      <Button variant="destructive" size="sm" onClick={handleResetUsage} disabled={resetUsage.isPending}>
                        {resetUsage.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                        Reset to 0
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Account Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Account Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Email</span>
                      <p className="font-medium">{userData.email}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Role</span>
                      <p className="font-medium capitalize">{userData.platform_role}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Created</span>
                      <p className="font-medium">{safeFormatDate(userData.created_at, "MMM d, yyyy")}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Updated</span>
                      <p className="font-medium">{safeFormatDate(userData.updated_at, "MMM d, yyyy")}</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Role & Tier Management */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Change Role</label>
                      <div className="flex gap-2">
                        <Select value={newRole} onValueChange={setNewRole}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select role..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="superadmin">Superadmin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button onClick={handleRoleChange} disabled={!newRole || updateUser.isPending} size="sm">
                          {updateUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Change Tier</label>
                      <div className="flex gap-2">
                        <Select value={newTier} onValueChange={setNewTier}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select tier..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="team">Team</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={() => {
                            if (!newTier) {
                              toast.error("Please select a tier first");
                              return;
                            }
                            setTierModalOpen(true);
                          }}
                          disabled={!newTier}
                          size="sm"
                        >
                          Configure
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Overages Management */}
              {userData.subscription_tier !== "free" && (
                <Card className="border-amber-200 dark:border-amber-900">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                      <Activity className="h-4 w-4" />
                      Overages Management
                    </CardTitle>
                    <CardDescription>
                      Control how the organization is billed when they exceed their tier limit.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {overagesData?.overages_disabled ? (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              <XCircle className="h-3 w-3 mr-1" />
                              Overages Disabled
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Overages Enabled
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500">
                          {overagesData?.overages_disabled
                            ? "User will be blocked at tier limit and shown upgrade message"
                            : "User can exceed tier limit and will be billed for overages"}
                        </p>
                        {overagesData?.reason && (
                          <p className="text-xs text-amber-600">Reason: {overagesData.reason}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {overagesData?.overages_disabled ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Enable Overages
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Enable Overage Billing?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will allow the user to exceed their tier limit. They will be billed for any requests over the limit.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleToggleOverages(false)}>
                                  {toggleOveragesMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                  Enable Overages
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm" className="text-amber-600 hover:text-amber-700">
                                <XCircle className="h-4 w-4 mr-1" />
                                Disable Overages
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Disable Overage Billing?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will block the user when they hit their tier limit. They will see an upgrade message instead of accruing overages.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <div className="py-4">
                                <label className="text-sm font-medium">Reason (optional)</label>
                                <Textarea
                                  placeholder="Enter a reason for disabling overages..."
                                  value={overagesReason}
                                  onChange={(e) => setOveragesReason(e.target.value)}
                                  className="mt-2"
                                />
                              </div>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setOveragesReason("")}>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleToggleOverages(true)} className="bg-amber-600 hover:bg-amber-700">
                                  {toggleOveragesMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                  Disable Overages
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Danger Zone */}
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-red-600 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    Danger Zone
                  </CardTitle>
                  <CardDescription>
                    These actions are destructive and may affect the user&apos;s access.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Suspend/Unsuspend */}
                  <div className="p-4 border border-red-200 dark:border-red-900 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          <Ban className="h-4 w-4" />
                          {isSuspended ? "Account Suspended" : "Suspend Account"}
                        </h4>
                        <p className="text-xs text-neutral-500">
                          {isSuspended
                            ? `Suspended ${suspendedAt ? safeFormatDistanceToNow(suspendedAt) : ""}${suspendedReason ? ` - Reason: ${suspendedReason}` : ""}`
                            : "Suspending will revoke all sessions and prevent login."}
                        </p>
                      </div>
                      {isSuspended ? (
                        <Button variant="outline" size="sm" onClick={handleUnsuspend} disabled={unsuspendMutation.isPending}>
                          {unsuspendMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Unsuspend
                        </Button>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Ban className="h-4 w-4 mr-1" />
                              Suspend
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Suspend User Account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will immediately revoke all sessions and prevent the user from logging in.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-4">
                              <label className="text-sm font-medium">Reason (optional)</label>
                              <Textarea
                                placeholder="Enter a reason for suspension..."
                                value={suspendReason}
                                onChange={(e) => setSuspendReason(e.target.value)}
                                className="mt-2"
                              />
                            </div>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleSuspend} className="bg-red-600 hover:bg-red-700">
                                {suspendMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Suspend Account
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>

                  {/* Delete Account */}
                  <div className="p-4 border border-red-200 dark:border-red-900 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-red-600 flex items-center gap-2">
                          <Trash2 className="h-4 w-4" />
                          Delete Account Permanently
                        </h4>
                        <p className="text-xs text-neutral-500">
                          This action cannot be undone. All user data will be permanently deleted.
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-red-600">Delete User Permanently?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action <strong>cannot be undone</strong>. This will permanently delete:
                              <ul className="list-disc list-inside mt-2 space-y-1">
                                <li>All sessions and login history</li>
                                <li>2FA settings and trusted devices</li>
                                <li>OAuth connections</li>
                                <li>Organization membership</li>
                              </ul>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteUser} className="bg-red-600 hover:bg-red-700">
                              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Delete Permanently
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security" className="space-y-6 mt-6">
              {/* 2FA Status */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Two-Factor Authentication
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {security.two_factor_enabled ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="h-3 w-3 mr-1" />
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {security.two_factor_enabled && (
                        <p className="text-xs text-neutral-500">
                          Enabled {security.two_factor_enabled_at ? safeFormatDistanceToNow(security.two_factor_enabled_at) : ""}
                          {security.backup_codes_remaining > 0 && ` - ${security.backup_codes_remaining} backup codes remaining`}
                        </p>
                      )}
                    </div>
                    {security.two_factor_enabled && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                            <ShieldOff className="h-4 w-4 mr-1" />
                            Disable 2FA
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Disable Two-Factor Authentication?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will disable 2FA, delete all backup codes, and remove trusted devices. The user will need to set up 2FA again.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDisable2FA} className="bg-red-600 hover:bg-red-700">
                              {disable2FAMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Disable 2FA
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Password Management */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Password
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-neutral-500">
                      {passwordChangedAt
                        ? `Last changed ${safeFormatDistanceToNow(passwordChangedAt)}`
                        : "Password change date unknown"}
                    </p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Force Reset
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Force Password Reset?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will invalidate the user&apos;s current password and revoke all sessions. The user will be forced to reset their password on next login.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleForcePasswordReset}>
                            {forcePasswordResetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Force Reset
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>

              {/* Active Sessions */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Active Sessions ({sessions.length})
                    </CardTitle>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                          <LogOut className="h-4 w-4 mr-1" />
                          Revoke All
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke All Sessions?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will log the user out of all devices immediately. They will need to log in again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRevokeSessions} className="bg-red-600 hover:bg-red-700">
                            {revokeSessionsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Revoke All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-48">
                    {sessions.length === 0 ? (
                      <p className="text-sm text-neutral-500">No active sessions</p>
                    ) : (
                      <div className="space-y-2">
                        {sessions.map((session) => (
                          <div key={session.id} className="flex items-center justify-between text-sm p-3 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div>
                              <p className="font-medium">{session.ip_address || "Unknown IP"}</p>
                              <p className="text-xs text-neutral-500 truncate max-w-[400px]">{session.user_agent || "Unknown device"}</p>
                            </div>
                            <div className="text-right">
                              <span className="text-neutral-400 text-xs">{safeFormatDistanceToNow(session.created_at)}</span>
                              {session.is_current && (
                                <Badge variant="outline" className="ml-2 text-xs">Current</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* OAuth Providers */}
              {oauthProviders.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Connected OAuth Providers ({oauthProviders.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Linked</TableHead>
                          <TableHead>Last Used</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {oauthProviders.map((provider) => (
                          <TableRow key={provider.provider}>
                            <TableCell className="font-medium capitalize">{provider.provider}</TableCell>
                            <TableCell>{provider.email || "-"}</TableCell>
                            <TableCell>{safeFormatDistanceToNow(provider.linked_at)}</TableCell>
                            <TableCell>{provider.last_used_at ? safeFormatDistanceToNow(provider.last_used_at) : "Never"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Trusted Devices */}
              {trustedDevices.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      Trusted Devices ({trustedDevices.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-32">
                      <div className="space-y-2">
                        {trustedDevices.map((device) => (
                          <div key={device.id} className="flex items-center justify-between text-sm p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div>
                              <p className="font-medium">{device.device_name || "Unknown Device"}</p>
                              <p className="text-xs text-neutral-500">{device.ip_address || "Unknown IP"}</p>
                            </div>
                            <span className="text-xs text-neutral-400">
                              {device.last_used_at ? safeFormatDistanceToNow(device.last_used_at) : "Never used"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* API Keys Tab */}
            <TabsContent value="apikeys" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    API Keys ({apiKeys.active_count} active / {apiKeys.total_count} total)
                  </CardTitle>
                  <CardDescription>
                    Total requests: {apiKeys.total_requests.toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {apiKeys.keys.length === 0 ? (
                    <p className="text-sm text-neutral-500 text-center py-8">No API keys</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Key Prefix</TableHead>
                          <TableHead>Requests</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Last Used</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apiKeys.keys.map((key) => (
                          <TableRow key={key.id}>
                            <TableCell className="font-medium">{key.name}</TableCell>
                            <TableCell className="font-mono text-sm">{key.key_prefix}...</TableCell>
                            <TableCell>{key.request_count.toLocaleString()}</TableCell>
                            <TableCell>{safeFormatDistanceToNow(key.created_at)}</TableCell>
                            <TableCell>{key.last_used_at ? safeFormatDistanceToNow(key.last_used_at) : "Never"}</TableCell>
                            <TableCell>
                              <Badge variant={key.status === "active" ? "default" : "secondary"}>
                                {key.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {key.status === "active" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700">
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will immediately revoke the API key &quot;{key.name}&quot;. Any applications using this key will stop working.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleRevokeApiKey(key.id)} className="bg-red-600 hover:bg-red-700">
                                        {revokeApiKeyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                        Revoke Key
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sessions Tab */}
            <TabsContent value="sessions" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Login History (Last 50)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loginHistory.length === 0 ? (
                    <p className="text-sm text-neutral-500 text-center py-8">No login history available</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>IP Address</TableHead>
                          <TableHead>Device</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Failure Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loginHistory.map((entry, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              {entry.status === "success" ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                            </TableCell>
                            <TableCell>{entry.ip_address || "Unknown"}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{entry.user_agent || "Unknown"}</TableCell>
                            <TableCell>{safeFormatDistanceToNow(entry.timestamp)}</TableCell>
                            <TableCell className="text-red-500">{entry.failure_reason || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Enterprise Tab */}
            {userData.subscription_tier === "enterprise" && (
              <TabsContent value="enterprise" className="space-y-6 mt-6">
                <EnterpriseLimitsContent orgId={userData.org_id} />
              </TabsContent>
            )}
          </Tabs>

          {/* Tier Change Modal */}
          <TierChangeModal
            userId={userId}
            selectedTier={newTier}
            currentTier={userData?.subscription_tier || "free"}
            orgId={userData?.org_id || ""}
            hasPaymentMethod={userData?.has_payment_method ?? false}
            open={tierModalOpen}
            onOpenChange={setTierModalOpen}
            onSuccess={() => {
              refetch();
              setNewTier("");
              toast.success("Tier updated successfully");
            }}
            currentPeriodEnd={userData?.billing_period_end}
          />
        </>
      ) : null}
    </div>
  );
}

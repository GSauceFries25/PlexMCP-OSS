"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow, isValid } from "date-fns";

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
import {
  Search,
  RefreshCw,
  Users,
  Building2,
  Server,
  Activity,
  DollarSign,
  ArrowRight,
  Shield,
  Crown,
  Star,
  User as UserIcon,
  Loader2,
  AlertCircle,
  ShieldX,
  KeyRound,
  Smartphone,
  History,
  ShieldAlert,
  Trash2,
  Ban,
  LogOut,
  RotateCcw,
  ShieldOff,
  CheckCircle2,
  XCircle,
  Globe,
  Key,
  Clock,
  Mail,
  Calendar,
  BarChart3,
  Headphones,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  useAdminUsers,
  useAdminStats,
  useAdminUpdateUser,
  useAdminSetUsage,
  useAdminResetUsage,
  useAdminUser,
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
  useAdminOrganizations,
} from "@/lib/api/hooks/use-admin";
import type { AdminUserResponse, SetCustomLimitsRequest } from "@/lib/api/client";
import type { User, Organization } from "@/types/database";
import { isUserAdmin } from "@/lib/utils/check-admin";
import { TierChangeModal } from "@/components/admin/TierChangeModal";

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

interface ExtendedUser extends User {
  org_id: string;
  org_name?: string;
  subscription_tier?: string;
  platform_role?: string;
}

// Enterprise Limits Tab Component
// Standalone enterprise limits content - can be used in both Tabs context and standalone
function EnterpriseLimitsContent({ orgId }: { orgId: string }) {
  const [formData, setFormData] = useState<SetCustomLimitsRequest>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch org limits
  const { data: limitsData, isLoading, error } = useAdminOrgLimits(orgId);
  const { data: historyData, isLoading: historyLoading } = useAdminLimitHistory(orgId, 1, 10);

  // Mutations
  const setLimitsMutation = useAdminSetOrgLimits();
  const clearLimitsMutation = useAdminClearOrgLimits();

  // Initialize form data when limits load
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
    const UNLIMITED = 2147483647; // Max i32 value
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
      <div className="space-y-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        </div>
      </div>
    );
  }

  if (error || !limitsData) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-neutral-500">Failed to load enterprise limits</p>
        </div>
      </div>
    );
  }

  const formatLimit = (value: number | null | undefined, tierDefault: number): string => {
    if (value === null || value === undefined) return `${tierDefault === 2147483647 ? "Unlimited" : tierDefault.toLocaleString()} (tier default)`;
    if (value >= 2147483647) return "Unlimited";
    return value.toLocaleString();
  };

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
          {/* Limits Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* MCPs */}
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

            {/* API Keys */}
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

            {/* Team Members */}
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

            {/* Monthly Requests */}
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

            {/* Overage Rate */}
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

            {/* Monthly Price */}
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

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Contract Notes</label>
            <Textarea
              placeholder="Add notes about the enterprise agreement..."
              value={formData.notes ?? ""}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={3}
            />
          </div>

          {/* Last Updated */}
          {limitsData.updated_at && (
            <p className="text-xs text-neutral-500">
              Last updated: {safeFormatDistanceToNow(limitsData.updated_at)}
              {limitsData.updated_by && ` by ${limitsData.updated_by.email}`}
            </p>
          )}

          <Separator />

          {/* Action Buttons */}
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
                      {change.change_type === "update" && `Updated ${change.field_name}: ${change.old_value} → ${change.new_value}`}
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

// Wrapper for Tabs context - wraps EnterpriseLimitsContent in TabsContent
function EnterpriseLimitsTab({ orgId }: { orgId: string }) {
  return (
    <TabsContent value="enterprise" className="space-y-6 mt-4">
      <EnterpriseLimitsContent orgId={orgId} />
    </TabsContent>
  );
}

function EnhancedUserDetailDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newRole, setNewRole] = useState<string>("");
  const [newTier, setNewTier] = useState<string>("");
  const [newUsage, setNewUsage] = useState<string>("");
  const [suspendReason, setSuspendReason] = useState<string>("");
  const [activeTab, setActiveTab] = useState("overview");
  const [tierModalOpen, setTierModalOpen] = useState(false);

  // Fetch detailed user info
  const { data: userData, isLoading: userLoading, error: userError } = useAdminUser(userId || "");

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

  if (!userId) return null;

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
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {userLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              <>
                {userData?.email}
                <Badge variant="secondary" className={ROLE_COLORS[userData?.platform_role || "user"]}>
                  {ROLE_ICONS[userData?.platform_role || "user"]}
                  <span className="ml-1">{userData?.platform_role || "user"}</span>
                </Badge>
                {userData?.is_suspended && (
                  <Badge variant="destructive">
                    <Ban className="h-3 w-3 mr-1" />
                    Suspended
                  </Badge>
                )}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            Manage user account, security, and access
          </DialogDescription>
        </DialogHeader>

        {userLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : userError ? (
          <div className="flex flex-col items-center justify-center py-8">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-neutral-500">Failed to load user details</p>
          </div>
        ) : userData ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 flex flex-col min-h-0">
            <TabsList className={`grid w-full shrink-0 ${userData.subscription_tier === "enterprise" ? "grid-cols-5" : "grid-cols-4"}`}>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              {userData.subscription_tier === "enterprise" && (
                <TabsTrigger value="enterprise" className="text-orange-600 data-[state=active]:text-orange-600">
                  Enterprise
                </TabsTrigger>
              )}
              <TabsTrigger value="danger" className="text-red-600 data-[state=active]:text-red-600">
                Danger
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-4">
              {/* User Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-neutral-400" />
                  <div>
                    <span className="text-neutral-500 block">Organization</span>
                    <p className="font-medium">{userData.org_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={TIER_COLORS[userData.subscription_tier || "free"]}>
                    {userData.subscription_tier || "free"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-neutral-400" />
                  <div>
                    <span className="text-neutral-500 block">Created</span>
                    <p className="font-medium">{safeFormatDate(userData.created_at, "MMM d, yyyy")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neutral-400" />
                  <div>
                    <span className="text-neutral-500 block">Limit</span>
                    <p className="font-medium">{limitDisplay}/mo</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {userData.email_verified ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span>{userData.email_verified ? "Verified" : "Not verified"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-neutral-400" />
                  <div>
                    <span className="text-neutral-500 block">Last Login</span>
                    <p className="font-medium">{userData.last_login_at ? safeFormatDistanceToNow(userData.last_login_at) : "Never"}</p>
                  </div>
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

              <Separator />

              {/* Usage Management */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Usage Management</label>
                <p className="text-xs text-neutral-500">
                  Current: {userData.usage.requests_used.toLocaleString()} / {limitDisplay} ({userData.usage.percentage_used.toFixed(1)}%)
                </p>
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
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security" className="space-y-6 mt-4">
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
                          {security.backup_codes_remaining > 0 && ` • ${security.backup_codes_remaining} backup codes remaining`}
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
                              This will disable 2FA for this user, delete all backup codes, and remove trusted devices. The user will need to set up 2FA again.
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
                  <ScrollArea className="h-32">
                    {sessions.length === 0 ? (
                      <p className="text-sm text-neutral-500">No active sessions</p>
                    ) : (
                      <div className="space-y-2">
                        {sessions.map((session) => (
                          <div key={session.id} className="flex items-center justify-between text-xs p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div>
                              <p className="font-medium">{session.ip_address || "Unknown IP"}</p>
                              <p className="text-neutral-500 truncate max-w-[300px]">{session.user_agent || "Unknown device"}</p>
                            </div>
                            <span className="text-neutral-400">{safeFormatDistanceToNow(session.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

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
                    <ScrollArea className="h-24">
                      <div className="space-y-2">
                        {trustedDevices.map((device) => (
                          <div key={device.id} className="flex items-center justify-between text-xs p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div>
                              <p className="font-medium">{device.device_name || "Unknown Device"}</p>
                              <p className="text-neutral-500">{device.ip_address || "Unknown IP"}</p>
                            </div>
                            <span className="text-neutral-400">
                              {device.last_used_at ? safeFormatDistanceToNow(device.last_used_at) : "Never used"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

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
                    <div className="flex flex-wrap gap-2">
                      {oauthProviders.map((provider) => (
                        <Badge key={provider.provider} variant="outline">
                          {provider.provider}
                          {provider.email && <span className="text-neutral-500 ml-1">({provider.email})</span>}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Force Password Reset */}
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
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="space-y-6 mt-4">
              {/* Login History */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Login History (Last 50)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-48">
                    {loginHistory.length === 0 ? (
                      <p className="text-sm text-neutral-500">No login history available</p>
                    ) : (
                      <div className="space-y-2">
                        {loginHistory.map((entry, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div className="flex items-center gap-2">
                              {entry.status === "success" ? (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-500" />
                              )}
                              <div>
                                <p className="font-medium">{entry.ip_address || "Unknown IP"}</p>
                                <p className="text-neutral-500 truncate max-w-[250px]">{entry.user_agent || "Unknown device"}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-neutral-400">{safeFormatDistanceToNow(entry.timestamp)}</span>
                              {entry.failure_reason && (
                                <p className="text-red-500">{entry.failure_reason}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* API Keys */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    API Keys ({apiKeys.active_count} active / {apiKeys.total_count} total)
                  </CardTitle>
                  <CardDescription>
                    Total requests: {apiKeys.total_requests.toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-36">
                    {apiKeys.keys.length === 0 ? (
                      <p className="text-sm text-neutral-500">No API keys</p>
                    ) : (
                      <div className="space-y-2">
                        {apiKeys.keys.map((key) => (
                          <div key={key.id} className="flex items-center justify-between text-xs p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
                            <div>
                              <p className="font-medium">{key.name}</p>
                              <p className="text-neutral-500 font-mono">{key.key_prefix}...</p>
                              <p className="text-neutral-400">
                                {key.request_count.toLocaleString()} requests •
                                {key.last_used_at ? ` Last used ${safeFormatDistanceToNow(key.last_used_at)}` : " Never used"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={key.status === "active" ? "default" : "secondary"}>
                                {key.status}
                              </Badge>
                              {key.status === "active" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600 hover:text-red-700">
                                      <XCircle className="h-3 w-3" />
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
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Enterprise Limits Tab - Only for enterprise tier */}
            {userData.subscription_tier === "enterprise" && (
              <EnterpriseLimitsTab orgId={userData.org_id} />
            )}

            {/* Danger Zone Tab */}
            <TabsContent value="danger" className="space-y-6 mt-4">
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-red-600 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    Danger Zone
                  </CardTitle>
                  <CardDescription>
                    These actions are destructive and may affect the user&apos;s access to the platform.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Suspend/Unsuspend */}
                  <div className="p-4 border border-red-200 dark:border-red-900 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          <Ban className="h-4 w-4" />
                          {isSuspended ? "Account Suspended" : "Suspend Account"}
                        </h4>
                        <p className="text-xs text-neutral-500">
                          {isSuspended
                            ? `Suspended ${suspendedAt ? safeFormatDistanceToNow(suspendedAt) : ""}${suspendedReason ? ` • Reason: ${suspendedReason}` : ""}`
                            : "Suspending will revoke all sessions and prevent the user from logging in."}
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
                              This action <strong>cannot be undone</strong>. This will permanently delete the user account and all associated data including:
                              <ul className="list-disc list-inside mt-2 space-y-1">
                                <li>All sessions and login history</li>
                                <li>2FA settings and trusted devices</li>
                                <li>OAuth connections</li>
                                <li>Organization membership (if sole owner, org may be orphaned)</li>
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
            </div>
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tier Change Modal */}
      {userData && userId && (
        <TierChangeModal
          userId={userId}
          selectedTier={newTier}
          currentTier={userData.subscription_tier || "free"}
          orgId={userData.org_id}
          hasPaymentMethod={userData.has_payment_method ?? false}
          open={tierModalOpen}
          onOpenChange={setTierModalOpen}
          onSuccess={() => {
            toast.success("Tier updated successfully");
            setNewTier("");
          }}
          currentPeriodEnd={userData.billing_period_end}
        />
      )}
    </Dialog>
  );
}

// Organization Detail Dialog
function OrganizationDetailDialog({
  org,
  open,
  onOpenChange,
}: {
  org: Organization | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Fetch organization limits if enterprise tier
  const { data: limitsData, isLoading: limitsLoading } = useAdminOrgLimits(
    org?.id || "",
    open && org?.subscription_tier === "enterprise"
  );

  if (!org) return null;

  const isEnterprise = org.subscription_tier === "enterprise";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {org.name}
          </DialogTitle>
          <DialogDescription>
            Organization settings and details
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-neutral-500">Subscription Tier</p>
              <Badge variant="secondary" className={TIER_COLORS[org.subscription_tier || "free"]}>
                {org.subscription_tier === "enterprise" && <Crown className="h-3 w-3 mr-1" />}
                {org.subscription_tier || "free"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-neutral-500">Status</p>
              <Badge variant="secondary" className={
                org.subscription_status === "active" ? "bg-green-100 text-green-700" :
                org.subscription_status === "trialing" ? "bg-blue-100 text-blue-700" :
                "bg-neutral-100 text-neutral-600"
              }>
                {org.subscription_status || "none"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-neutral-500">Created</p>
              <p className="text-sm font-medium">
                {org.created_at ? new Date(org.created_at).toLocaleDateString() : "Unknown"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-neutral-500">Organization ID</p>
              <p className="text-xs font-mono text-neutral-500 truncate">{org.id}</p>
            </div>
          </div>

          {/* Enterprise Custom Limits */}
          {isEnterprise && (
            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Crown className="h-5 w-5 text-orange-500" />
                Enterprise Custom Limits
              </h3>

              {limitsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <EnterpriseLimitsContent orgId={org.id} />
              )}
            </div>
          )}

          {/* Non-Enterprise Info */}
          {!isEnterprise && (
            <div className="border-t pt-4">
              <div className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-4">
                <p className="text-sm text-neutral-500">
                  Enterprise custom limits are only available for Enterprise tier organizations.
                  Current tier: <span className="font-medium">{org.subscription_tier || "free"}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [orgPage, setOrgPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<ExtendedUser | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [adminTab, setAdminTab] = useState<"users" | "organizations">("users");

  // Check if user is an admin
  const isAdmin = useMemo(() => isUserAdmin(user), [user]);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast.error("Access denied. Admin privileges required.");
      router.push("/");
    }
  }, [authLoading, isAdmin, router]);

  // Only fetch admin data when auth is loaded and user is admin
  const shouldFetch = !authLoading && isAdmin;
  const { data: usersData, isLoading: usersLoading, error: usersError, refetch: refetchUsers } = useAdminUsers(page, 50, shouldFetch);
  const { data: orgsData, isLoading: orgsLoading, refetch: refetchOrgs } = useAdminOrganizations(orgPage, 50, shouldFetch);
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useAdminStats(shouldFetch);

  const users = usersData?.items || [];
  const organizations = orgsData?.items || [];

  // Filter users by search
  const filteredUsers = users.filter((user) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.email.toLowerCase().includes(query) ||
      user.name?.toLowerCase().includes(query) ||
      (user as ExtendedUser).org_name?.toLowerCase().includes(query)
    );
  });

  // Filter organizations by search and tier
  const filteredOrgs = organizations.filter((org) => {
    if (tierFilter !== "all" && org.subscription_tier !== tierFilter) return false;
    if (!orgSearchQuery) return true;
    const query = orgSearchQuery.toLowerCase();
    return org.name.toLowerCase().includes(query);
  });

  const handleRefresh = () => {
    refetchUsers();
    refetchOrgs();
    refetchStats();
    toast.success("Data refreshed");
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

  // Show error state if API calls failed
  if (usersError || statsError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load Admin Data</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          {(usersError as Error)?.message || (statsError as Error)?.message || "An error occurred while loading admin data. Please try again."}
        </p>
        <Button onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Platform Admin
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Manage users, organizations, and platform settings
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Total Users</div>
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats?.total_users?.toLocaleString() || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-purple-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Organizations</div>
              </div>
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {stats?.total_organizations?.toLocaleString() || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-green-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">MCPs</div>
              </div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats?.total_mcps?.toLocaleString() || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Requests Today</div>
              </div>
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {stats?.total_requests_today?.toLocaleString() || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Revenue MTD</div>
              </div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                ${(stats?.revenue_mtd || 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/admin/analytics">
          <Button variant="outline" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Platform Analytics
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/admin/website-analytics">
          <Button variant="outline" className="gap-2">
            <Globe className="h-4 w-4" />
            Website Analytics
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/admin/mcp-logs">
          <Button variant="outline" className="gap-2">
            <Activity className="h-4 w-4" />
            MCP Proxy Logs
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/admin/support">
          <Button variant="outline" className="gap-2">
            <Headphones className="h-4 w-4" />
            Support Tickets
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/admin/inbox">
          <Button variant="outline" className="gap-2">
            <Mail className="h-4 w-4" />
            Admin Inbox
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/admin/superadmin">
          <Button variant="outline" className="gap-2 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20">
            <Crown className="h-4 w-4" />
            Superadmin Panel
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Admin Tabs */}
      <Tabs value={adminTab} onValueChange={(v) => setAdminTab(v as "users" | "organizations")} className="space-y-4">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2">
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="organizations" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Organizations
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          {/* Search */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                placeholder="Search users..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Users Table */}
          {usersLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  No users found
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {searchQuery ? "Try adjusting your search" : "No users registered yet"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const extUser = user as ExtendedUser;
                    return (
                      <TableRow
                        key={user.id}
                        className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        onClick={() => setSelectedUser(extUser)}
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">{user.email}</p>
                            {user.name && (
                              <p className="text-sm text-neutral-500">{user.name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-neutral-600 dark:text-neutral-400">
                            {extUser.org_name || "N/A"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={TIER_COLORS[extUser.subscription_tier || "free"]}>
                            {extUser.subscription_tier || "free"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={ROLE_COLORS[extUser.platform_role || "user"]}>
                            {ROLE_ICONS[extUser.platform_role || "user"]}
                            <span className="ml-1">{extUser.platform_role || "user"}</span>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-neutral-500">
                            {safeFormatDistanceToNow(user.created_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-neutral-400" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {usersData && usersData.total_pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-neutral-500">
                    Page {page} of {usersData.total_pages} ({usersData.total} users)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === usersData.total_pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* Organizations Tab */}
        <TabsContent value="organizations" className="space-y-4">
          {/* Search and Filter */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                placeholder="Search organizations..."
                className="pl-10"
                value={orgSearchQuery}
                onChange={(e) => setOrgSearchQuery(e.target.value)}
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="enterprise">
                  <span className="flex items-center gap-2">
                    <Crown className="h-3 w-3 text-orange-500" />
                    Enterprise
                  </span>
                </SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="free">Free</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Organizations Table */}
          {orgsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredOrgs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  No organizations found
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {orgSearchQuery || tierFilter !== "all" ? "Try adjusting your filters" : "No organizations created yet"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrgs.map((org) => (
                    <TableRow
                      key={org.id}
                      className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      onClick={() => setSelectedOrg(org)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{org.name}</p>
                          {org.subscription_tier === "enterprise" && (
                            <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                              Enterprise
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={TIER_COLORS[org.subscription_tier || "free"]}>
                          {org.subscription_tier === "enterprise" && <Crown className="h-3 w-3 mr-1" />}
                          {org.subscription_tier || "free"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={
                          org.subscription_status === "active" ? "bg-green-100 text-green-700" :
                          org.subscription_status === "trialing" ? "bg-blue-100 text-blue-700" :
                          "bg-neutral-100 text-neutral-600"
                        }>
                          {org.subscription_status || "none"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-neutral-500">
                          {safeFormatDistanceToNow(org.created_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-neutral-400" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {orgsData && orgsData.total_pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-neutral-500">
                    Page {orgPage} of {orgsData.total_pages} ({orgsData.total} organizations)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={orgPage === 1}
                      onClick={() => setOrgPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={orgPage === orgsData.total_pages}
                      onClick={() => setOrgPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* User Detail Dialog */}
      <EnhancedUserDetailDialog
        userId={selectedUser?.id || null}
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      />

      <OrganizationDetailDialog
        org={selectedOrg}
        open={!!selectedOrg}
        onOpenChange={(open) => !open && setSelectedOrg(null)}
      />
    </div>
  );
}

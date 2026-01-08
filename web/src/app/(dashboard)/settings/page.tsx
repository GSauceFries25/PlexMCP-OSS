"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Settings, Bell, Shield, Trash2, Globe, Lock, User, KeyRound, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { useOrganization, useUpdateOrganization, useDeleteOrganization, useAddons, useNotificationPreferences, useUpdateNotificationPreferences } from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import { PinManagementCard } from "@/components/pin";
import { TwoFactorManagementCard } from "@/components/two-factor";
import { DomainManagement, CustomSubdomainEditor, PrivacyCard } from "@/components/settings";
import { useTheme } from "@/providers/theme-provider";
import { PasswordChangeDialog, ConnectedAccountsCard } from "@/components/account";
import { getMcpUrl, getDisplaySubdomain, type OrganizationForUrl } from "@/lib/mcp-url";
import { Copy, Link2 } from "lucide-react";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

// Valid tab values
const VALID_TABS = ["account", "general", "notifications", "security", "domains", "privacy", "danger"] as const;
type TabValue = typeof VALID_TABS[number];

export default function SettingsPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const { currentOrganization, organizationsLoading, refreshOrganizations, user, isSigningOut, isSigningOutSync } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  // Get tab from URL, default to "account"
  const tabFromUrl = searchParams.get("tab") as TabValue | null;
  const initialTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : "account";
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);

  // Update URL when tab changes
  const handleTabChange = useCallback((value: string) => {
    const newTab = value as TabValue;
    setActiveTab(newTab);

    // Update URL without full page reload
    const url = new URL(window.location.href);
    url.searchParams.set("tab", newTab);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  // Sync tab state with URL on mount and when URL changes
  useEffect(() => {
    const tabParam = searchParams.get("tab") as TabValue | null;
    if (tabParam && VALID_TABS.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);

  const { data: organization, isLoading } = useOrganization(organizationId);
  const updateOrganization = useUpdateOrganization();
  const deleteOrganization = useDeleteOrganization();
  const { data: addonsData } = useAddons(organizationId);

  // Notification preferences
  const { data: notificationPrefs, isLoading: notificationsLoading } = useNotificationPreferences();
  const updateNotificationPrefs = useUpdateNotificationPreferences();

  // Custom domain addon status for tab indicator
  const tier = currentOrganization?.subscription_tier ?? "free";
  const isFree = tier.toLowerCase() === "free";
  const customDomainAddon = addonsData?.addons?.find(
    (a) => a.addon_type === "custom_domain"
  );
  const isDomainsEnabled = customDomainAddon?.enabled ?? false;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);

  // Organization settings form state
  const [orgSettings, setOrgSettings] = useState({
    name: "",
  });

  // Update form when organization data loads
  useEffect(() => {
    if (organization) {
      setOrgSettings({
        name: organization.name || "",
      });
    }
  }, [organization]);

  // Notification settings (form state - synced with API)
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    weeklyDigest: false,
    usageAlerts: true,
    marketingEmails: false,
    securityAlerts: true,
    apiErrors: true,
  });

  // Sync notification form state with API data when it loads
  useEffect(() => {
    if (notificationPrefs) {
      setNotifications({
        emailAlerts: notificationPrefs.email_alerts,
        weeklyDigest: notificationPrefs.weekly_digest,
        usageAlerts: notificationPrefs.usage_alerts,
        marketingEmails: notificationPrefs.marketing_emails,
        securityAlerts: notificationPrefs.security_alerts,
        apiErrors: notificationPrefs.api_error_notifications,
      });
    }
  }, [notificationPrefs]);

  // Security settings (local state - could be wired to API later)
  const [security, setSecurity] = useState({
    twoFactorEnabled: false,
    ipWhitelist: "",
    sessionTimeout: "30",
  });

  const handleSaveOrganization = async () => {
    try {
      await updateOrganization.mutateAsync({
        id: organizationId,
        data: {
          name: orgSettings.name,
        },
      });
      await refreshOrganizations();
      toast.success("Organization settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  const handleSaveNotifications = async () => {
    try {
      await updateNotificationPrefs.mutateAsync({
        email_alerts: notifications.emailAlerts,
        weekly_digest: notifications.weeklyDigest,
        usage_alerts: notifications.usageAlerts,
        api_error_notifications: notifications.apiErrors,
        marketing_emails: notifications.marketingEmails,
      });
      toast.success("Notification preferences saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save notification preferences");
    }
  };

  const handleSaveSecurity = async () => {
    // In a real app, this would call an API
    toast.success("Security settings saved");
  };

  const handleDeleteOrganization = async () => {
    if (deleteConfirmation !== organization?.slug) {
      toast.error("Please type the organization slug to confirm");
      return;
    }

    try {
      await deleteOrganization.mutateAsync(organizationId);
      toast.success("Organization deleted");
      setIsDeleteDialogOpen(false);
      await refreshOrganizations();
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete organization");
    }
  };

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || isLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-32 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-10 w-96" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // If user is null, they're signing out or not logged in - show loading
  if (!currentOrganization) {
    if (!user) {
      return (
        <div className="space-y-6">
          <Skeleton className="h-9 w-32 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Settings className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization settings and preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="account" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="domains" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Domains
            {isFree && (
              <Lock className="h-3 w-3 text-muted-foreground" />
            )}
            {!isFree && !isDomainsEnabled && (
              <Badge variant="outline" className="ml-1 text-xs px-1.5 py-0">
                Add-on
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="privacy" className="flex items-center gap-2">
            <UserX className="h-4 w-4" />
            Privacy
          </TabsTrigger>
          <TabsTrigger value="danger" className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            Danger Zone
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                Your personal account details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Email Address</Label>
                <Input
                  value={user?.email || ""}
                  disabled
                  className="bg-muted"
                />
                <p className="text-sm text-muted-foreground">
                  Your email address is used for login and notifications
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input
                  value={user?.user_metadata?.name || user?.user_metadata?.full_name || ""}
                  disabled
                  className="bg-muted"
                />
              </div>
            </CardContent>
          </Card>

          {/* Password Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Password
              </CardTitle>
              <CardDescription>
                Manage your account password
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                It&apos;s a good idea to use a strong password that you don&apos;t use elsewhere.
              </p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => setIsPasswordDialogOpen(true)}>
                Change Password
              </Button>
            </CardFooter>
          </Card>

          {/* Connected Accounts */}
          <ConnectedAccountsCard />
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Profile</CardTitle>
              <CardDescription>
                Basic information about your organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  value={orgSettings.name}
                  onChange={(e) => setOrgSettings({ ...orgSettings, name: e.target.value })}
                />
              </div>

              {/* Custom Subdomain Editor - Pro, Team, Enterprise only */}
              {tier.toLowerCase() !== "free" && tier.toLowerCase() !== "starter" && (
                <div className="grid gap-2 pt-4 border-t">
                  <Label>Custom Subdomain</Label>
                  <p className="text-sm text-muted-foreground">
                    Personalize your MCP endpoint URL
                  </p>
                  <CustomSubdomainEditor
                    currentSubdomain={(organization as { custom_subdomain?: string })?.custom_subdomain || (currentOrganization as { custom_subdomain?: string })?.custom_subdomain}
                    autoSubdomain={(organization as { auto_subdomain?: string })?.auto_subdomain || (currentOrganization as { auto_subdomain?: string })?.auto_subdomain}
                    organizationId={organizationId}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="org-subdomain">MCP Endpoint</Label>
                {(() => {
                  // Build organization object for URL generation
                  // Prioritize organization (from react-query, gets invalidated) over currentOrganization (from auth provider)
                  const orgForUrl: OrganizationForUrl = {
                    id: organization?.id || currentOrganization?.id || "",
                    slug: organization?.slug || currentOrganization?.slug,
                    auto_subdomain: (organization as { auto_subdomain?: string })?.auto_subdomain || (currentOrganization as { auto_subdomain?: string })?.auto_subdomain,
                    custom_subdomain: (organization as { custom_subdomain?: string })?.custom_subdomain || (currentOrganization as { custom_subdomain?: string })?.custom_subdomain,
                    subscription_tier: tier,
                  };

                  // Get the display subdomain and full MCP URL
                  const displaySubdomain = getDisplaySubdomain(orgForUrl);
                  const mcpUrlResult = getMcpUrl({ organization: orgForUrl });

                  const handleCopyUrl = () => {
                    navigator.clipboard.writeText(mcpUrlResult.url);
                    toast.success("MCP endpoint copied to clipboard");
                  };

                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="org-subdomain"
                            value={mcpUrlResult.url}
                            disabled
                            className="font-mono text-sm pr-10"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleCopyUrl}
                          title="Copy MCP endpoint"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          {isFree ? (
                            <>
                              Your subdomain: <code className="bg-muted px-1 py-0.5 rounded text-xs">{displaySubdomain}</code>
                            </>
                          ) : (
                            <>
                              Subdomain: <code className="bg-muted px-1 py-0.5 rounded text-xs">{displaySubdomain}</code>
                            </>
                          )}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
              {/* TODO: Website and timezone settings - requires API support */}
            </CardContent>
            <CardFooter>
              <Button onClick={handleSaveOrganization} disabled={updateOrganization.isPending}>
                {updateOrganization.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of your dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose your preferred color scheme
                  </p>
                </div>
                <Select
                  value={theme}
                  onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>
                Configure which emails you want to receive
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive email notifications for important events
                  </p>
                </div>
                <Switch
                  checked={notifications.emailAlerts}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, emailAlerts: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Weekly Digest</Label>
                  <p className="text-sm text-muted-foreground">
                    Get a weekly summary of your API usage
                  </p>
                </div>
                <Switch
                  checked={notifications.weeklyDigest}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, weeklyDigest: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Usage Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified when approaching usage limits
                  </p>
                </div>
                <Switch
                  checked={notifications.usageAlerts}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, usageAlerts: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Security Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Important security notifications (cannot be disabled)
                  </p>
                </div>
                <Switch checked={notifications.securityAlerts} disabled />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>API Error Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified when API errors exceed threshold
                  </p>
                </div>
                <Switch
                  checked={notifications.apiErrors}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, apiErrors: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Marketing Emails</Label>
                  <p className="text-sm text-muted-foreground">
                    Product updates and promotional content
                  </p>
                </div>
                <Switch
                  checked={notifications.marketingEmails}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, marketingEmails: checked })
                  }
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleSaveNotifications}>
                Save Preferences
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          {/* Two-Factor Authentication */}
          <TwoFactorManagementCard />

          <Card>
            <CardHeader>
              <CardTitle>Session Security</CardTitle>
              <CardDescription>
                Configure session timeout and IP restrictions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
                <Select
                  value={security.sessionTimeout}
                  onValueChange={(value) => setSecurity({ ...security, sessionTimeout: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select timeout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="120">2 hours</SelectItem>
                    <SelectItem value="480">8 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ip-whitelist">IP Whitelist</Label>
                <Input
                  id="ip-whitelist"
                  placeholder="e.g., 192.168.1.0/24, 10.0.0.1"
                  value={security.ipWhitelist}
                  onChange={(e) => setSecurity({ ...security, ipWhitelist: e.target.value })}
                />
                <p className="text-sm text-muted-foreground">
                  Comma-separated list of IP addresses or CIDR blocks. Leave empty to allow all IPs.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleSaveSecurity}>
                Save Security Settings
              </Button>
            </CardFooter>
          </Card>

          {/* PIN Protection Card */}
          <PinManagementCard />

          <Card>
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
              <CardDescription>
                View and manage your active sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="space-y-1">
                    <div className="font-medium">Current Session</div>
                    <div className="text-sm text-muted-foreground">
                      Chrome on macOS
                    </div>
                  </div>
                  <div className="text-sm text-green-500">Active now</div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline">Sign Out All Other Sessions</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="domains" className="space-y-4">
          <DomainManagement />
        </TabsContent>

        <TabsContent value="privacy" className="space-y-4">
          <PrivacyCard />
        </TabsContent>

        <TabsContent value="danger" className="space-y-4">
          <Alert variant="destructive">
            <Trash2 className="h-4 w-4" />
            <AlertTitle>Danger Zone</AlertTitle>
            <AlertDescription>
              The actions in this section are irreversible. Please proceed with caution.
            </AlertDescription>
          </Alert>

          <Card className="border-destructive">
            <CardHeader>
              <CardTitle>Delete Organization</CardTitle>
              <CardDescription>
                Permanently delete your organization and all associated data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                This action will:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 mb-4">
                <li>Delete all MCPs and their configurations</li>
                <li>Revoke all API keys</li>
                <li>Remove all team members</li>
                <li>Delete all usage data and analytics</li>
                <li>Cancel your subscription immediately</li>
              </ul>
              <p className="text-sm font-medium text-destructive">
                This action cannot be undone.
              </p>
            </CardContent>
            <CardFooter>
              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">Delete Organization</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Are you absolutely sure?</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. This will permanently delete your
                      organization and remove all data from our servers.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      Please type <strong>{organization?.slug}</strong> to confirm:
                    </p>
                    <Input
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="Enter organization slug"
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteOrganization}
                      disabled={deleteConfirmation !== organization?.slug || deleteOrganization.isPending}
                    >
                      {deleteOrganization.isPending ? "Deleting..." : "Delete Organization"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Password Change Dialog */}
      <PasswordChangeDialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
    </div>
  );
}

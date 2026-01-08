"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Plus,
  Link2,
  MoreHorizontal,
  Copy,
  Trash2,
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Settings,
  Server,
  ChevronRight,
  ChevronLeft,
  Unlock,
  Lock,
  Info,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey, useUpdateApiKey, useMCPs, usePinStatus, useRevealApiKey, useSubscription, useTeamMembers, useDomains } from "@/lib/api/hooks";
import type { UserRole } from "@/types/database";
import { getMcpUrl, type OrganizationForUrl } from "@/lib/mcp-url";
import { Sparkles, Crown } from "lucide-react";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import { SetPinDialog, VerifyPinDialog, EncryptWithPinDialog } from "@/components/pin";
import { DatePicker } from "@/components/ui/date-picker";
import type { MCP } from "@/types/database";

// MCP Access Mode type
type MCPAccessMode = "all" | "selected" | "none";

// Wizard step type
type WizardStep = 1 | 2 | 3;

export default function ConnectionsPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, user, isSigningOut, isSigningOutSync } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: apiKeys, isLoading, error } = useApiKeys(organizationId);
  const { data: mcps } = useMCPs(organizationId);
  const { data: teamMembers } = useTeamMembers(organizationId);
  // Only fetch domains when we have a valid organization (auth is ready)
  const { data: customDomains } = useDomains({ enabled: !!organizationId });

  // Get current user's role in the organization
  // Try matching by ID first, then by email as fallback (for OAuth users with different IDs)
  const currentUserRole = (
    teamMembers?.find(m => m.id === user?.id)?.role ||
    teamMembers?.find(m => m.email === user?.email)?.role
  ) as UserRole | undefined;

  // Check if user is organization owner (fallback for when team member lookup fails)
  const isOrgOwner = currentOrganization?.owner_id === user?.id ||
    teamMembers?.some(m => m.email === user?.email && m.role === "owner");

  // Helper to check if user can manage (revoke) a connection
  const canManageConnection = (connectionCreatedBy: string | null | undefined): boolean => {
    // If user is org owner, they can manage anything
    if (isOrgOwner) return true;
    // If we have a role from team members
    if (currentUserRole) {
      // Owners and admins can manage any connection
      if (currentUserRole === "owner" || currentUserRole === "admin") return true;
      // Members can only manage their own connections
      if (currentUserRole === "member") return connectionCreatedBy === user?.id;
    }
    // Fallback: if user created the connection, they can manage it
    if (connectionCreatedBy === user?.id) return true;
    // Viewers and unknown roles cannot manage connections
    return false;
  };
  const createApiKey = useCreateApiKey(organizationId);
  const revokeApiKey = useRevokeApiKey(organizationId);
  const rotateApiKey = useRotateApiKey(organizationId);
  const updateApiKey = useUpdateApiKey(organizationId);

  // Subscription info for tier-based limits
  const { data: subscription } = useSubscription(organizationId);

  // Calculate connection limits based on tier
  const getTierLimit = (tier: string | undefined) => {
    switch (tier?.toLowerCase()) {
      case "free": return 5;
      case "pro": return 20;
      case "team": return 50;
      case "enterprise": return Infinity;
      default: return 5;
    }
  };

  // Helper functions for usage progress bar
  const getUsagePercentage = (used: number, limit: number): number =>
    limit === Infinity ? 0 : Math.min((used / limit) * 100, 100);

  const getProgressBarColor = (percentage: number): string => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 70) return "bg-amber-500";
    return "bg-primary";
  };

  const formatLimit = (limit: number): string =>
    limit === Infinity ? "Unlimited" : limit.toString();

  const connectionLimit = getTierLimit(subscription?.tier);
  const isAtLimit = (apiKeys?.length ?? 0) >= connectionLimit;
  const isUnlimited = connectionLimit === Infinity;

  // Upgrade dialog state
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);

  // PIN status - only fetch when user is authenticated (has currentOrganization)
  const { data: pinStatus } = usePinStatus({ enabled: !!currentOrganization });
  const hasPin = pinStatus?.has_pin ?? false;

  // PIN dialog state
  const [isSetPinDialogOpen, setIsSetPinDialogOpen] = useState(false);
  const [isVerifyPinDialogOpen, setIsVerifyPinDialogOpen] = useState(false);
  const [keyToReveal, setKeyToReveal] = useState<{ id: string; name: string } | null>(null);

  // Dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Form state
  const [connectionName, setConnectionName] = useState("");
  const [mcpAccessMode, setMcpAccessMode] = useState<MCPAccessMode>("all");
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);

  // Result state - track both the secret and which connection it belongs to
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [newKeyConnectionId, setNewKeyConnectionId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  // Encrypt with PIN dialog state
  const [isEncryptDialogOpen, setIsEncryptDialogOpen] = useState(false);
  const [pendingEncryptAction, setPendingEncryptAction] = useState<{
    type: "create" | "rotate";
    connection?: Connection;
  } | null>(null);

  // Connection type from API keys
  type Connection = NonNullable<typeof apiKeys>[number];

  // Edit connection dialog state
  const [editConnection, setEditConnection] = useState<Connection | null>(null);
  const [editName, setEditName] = useState("");
  const [editMcpAccessMode, setEditMcpAccessMode] = useState<MCPAccessMode>("all");
  const [editSelectedMcpIds, setEditSelectedMcpIds] = useState<string[]>([]);
  const [editExpirationDate, setEditExpirationDate] = useState<Date | undefined>(undefined);

  // Quick Connect dialog state
  const [quickConnectConnection, setQuickConnectConnection] = useState<Connection | null>(null);
  const [quickConnectApiKey, setQuickConnectApiKey] = useState("");
  const [showQuickConnectKey, setShowQuickConnectKey] = useState(false);

  // Auto-copy API key to clipboard when Step 3 loads
  useEffect(() => {
    if (wizardStep === 3 && newKeySecret) {
      navigator.clipboard.writeText(newKeySecret).then(() => {
        toast.success("API key copied to clipboard - save it securely!");
      }).catch(() => {
        // Clipboard write failed silently - user can still copy manually
      });
    }
  }, [wizardStep, newKeySecret]);

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key) return "";
    const prefix = key.slice(0, 10);
    return `${prefix}${"*".repeat(Math.min(key.length - 10, 20))}`;
  };

  // Get the MCP URL based on organization settings
  const getMcpUrlForOrg = (): string => {
    if (!currentOrganization) return "https://api.plexmcp.com/mcp";

    const orgForUrl: OrganizationForUrl = {
      id: currentOrganization.id,
      slug: currentOrganization.slug,
      auto_subdomain: (currentOrganization as { auto_subdomain?: string }).auto_subdomain,
      custom_subdomain: (currentOrganization as { custom_subdomain?: string }).custom_subdomain,
      subscription_tier: subscription?.tier,
    };

    // Pass custom domains to enable custom domain URL when active
    return getMcpUrl({
      organization: orgForUrl,
      customDomains: customDomains ?? [],
    }).url;
  };

  const mcpUrl = getMcpUrlForOrg();

  // Config generators for each client
  const getClaudeConfig = (apiKey: string) => JSON.stringify({
    mcpServers: {
      plexmcp: {
        url: mcpUrl,
        headers: {
          "X-API-Key": apiKey
        }
      }
    }
  }, null, 2);

  const getVSCodeConfig = (apiKey: string) => JSON.stringify({
    servers: {
      plexmcp: {
        type: "sse",
        url: mcpUrl,
        headers: {
          "X-API-Key": apiKey
        }
      }
    }
  }, null, 2);

  const getCursorConfig = (apiKey: string) => JSON.stringify({
    mcpServers: {
      plexmcp: {
        url: mcpUrl,
        headers: {
          "X-API-Key": apiKey
        }
      }
    }
  }, null, 2);

  const getChatGPTInfo = (apiKey: string) => `ChatGPT Custom GPTs can use PlexMCP via HTTP API.

Authentication Header:
Authorization: Bearer ${apiKey}

MCP Endpoint: ${mcpUrl}

See documentation for OpenAPI spec to import as a Custom GPT action.`;

  const getCurlExample = (apiKey: string) => `# Test MCP connection
curl -X POST ${mcpUrl} \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`;

  // Client info with file paths
  const clientInfo: Record<string, {
    name: string;
    filePath: { mac?: string; windows?: string; workspace?: string; global?: string } | null;
    getConfig: (apiKey: string) => string;
    instructions: string;
  }> = {
    claude: {
      name: "Claude Desktop",
      filePath: {
        mac: "~/Library/Application Support/Claude/claude_desktop_config.json",
        windows: "%APPDATA%\\Claude\\claude_desktop_config.json"
      },
      getConfig: getClaudeConfig,
      instructions: "Add this to your Claude Desktop config file, then restart Claude."
    },
    vscode: {
      name: "VS Code",
      filePath: {
        workspace: ".vscode/mcp.json",
        global: "Use Command Palette: 'MCP: Open User Configuration'"
      },
      getConfig: getVSCodeConfig,
      instructions: "Create .vscode/mcp.json in your workspace, or add to global config."
    },
    cursor: {
      name: "Cursor",
      filePath: {
        global: "~/.cursor/mcp.json",
      },
      getConfig: getCursorConfig,
      instructions: "Add to your Cursor config file. Use global for all projects."
    },
    chatgpt: {
      name: "ChatGPT",
      filePath: null,
      getConfig: getChatGPTInfo,
      instructions: "Use the HTTP API in Custom GPT actions."
    },
    http: {
      name: "HTTP/cURL",
      filePath: null,
      getConfig: getCurlExample,
      instructions: "Test the API directly or integrate with any HTTP client."
    }
  };

  // Internal function to create connection with optional PIN
  const doCreateConnection = async (pin?: string) => {
    try {
      const result = await createApiKey.mutateAsync({
        name: connectionName,
        scopes: ["read", "write"],
        pin,
        // Send MCP access control settings
        mcp_access_mode: mcpAccessMode,
        allowed_mcp_ids: mcpAccessMode === "selected" ? selectedMcpIds : undefined,
        // Send expiration date if set
        expires_at: expirationDate?.toISOString(),
      });

      if (result?.secret) {
        setNewKeySecret(result.secret);
        // Store the connection ID so we can identify which connection owns this key
        setNewKeyConnectionId(result.api_key?.id || null);
        setWizardStep(3);
        toast.success("Connection created successfully!");
      } else {
        toast.success("Connection created successfully");
        handleCloseDialog();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create connection");
    }
  };

  const handleCreateConnection = async () => {
    if (!connectionName) {
      toast.error("Connection name is required");
      return;
    }

    // If user has PIN, prompt for it to encrypt the key
    if (hasPin) {
      setPendingEncryptAction({ type: "create" });
      setIsEncryptDialogOpen(true);
    } else {
      // No PIN - create without encryption
      await doCreateConnection();
    }
  };

  // Just close the dialog - key persists for later viewing
  const handleCloseDialog = () => {
    setIsCreateDialogOpen(false);
  };

  // Clear everything and start fresh
  const handleClearAndStartNew = () => {
    setNewKeySecret(null);
    setNewKeyConnectionId(null);
    setShowApiKey(false);
    setWizardStep(1);
    setConnectionName("");
    setMcpAccessMode("all");
    setSelectedMcpIds([]);
    setExpirationDate(undefined);
  };

  // Open dialog - always start fresh at step 1 (if not at limit)
  const handleOpenDialog = () => {
    // Check if at connection limit
    if (isAtLimit) {
      setIsUpgradeDialogOpen(true);
      return;
    }

    // Clear any previous state and start fresh
    setNewKeySecret(null);
    setNewKeyConnectionId(null);
    setShowApiKey(false);
    setConnectionName("");
    setMcpAccessMode("all");
    setSelectedMcpIds([]);
    setExpirationDate(undefined);
    setWizardStep(1);
    setIsCreateDialogOpen(true);
  };

  const handleCloseQuickConnect = () => {
    setQuickConnectConnection(null);
    setQuickConnectApiKey("");
    setShowQuickConnectKey(false);
  };

  // State for regenerate warning flow
  const [showRegenerateWarning, setShowRegenerateWarning] = useState(false);
  const [connectionToRegenerate, setConnectionToRegenerate] = useState<Connection | null>(null);
  const [isRegenerateAction, setIsRegenerateAction] = useState(false);

  // State for delete confirmation flow
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<Connection | null>(null);

  // Ref to track regeneration flow (refs update synchronously, unlike state)
  const isRegeneratingRef = useRef(false);

  const openQuickConnect = (connection: Connection) => {
    setQuickConnectConnection(connection);
    setShowQuickConnectKey(false);

    // Only pre-fill if we have the key in session memory for this specific connection
    if (newKeyConnectionId === connection.id && newKeySecret) {
      setQuickConnectApiKey(newKeySecret);
    } else {
      setQuickConnectApiKey("");
      // Don't auto-trigger PIN verification - user must click "Reveal Key" button
    }
  };

  // Internal function to rotate key with optional PIN
  const doRotateKey = async (connection: Connection, pin?: string) => {
    if (isRotating) return;

    setIsRotating(true);
    try {
      // Use the proper rotation endpoint - this keeps the same connection ID
      const result = await rotateApiKey.mutateAsync({ keyId: connection.id, pin });

      // Backend returns "key" not "secret"
      const newKey = result?.key || result?.secret;
      if (newKey) {
        // Store the new key - connection ID stays the same!
        setNewKeySecret(newKey);
        setNewKeyConnectionId(connection.id); // Same ID as before
        setQuickConnectApiKey(newKey);
        toast.success("API key rotated successfully! New key has been copied.");
        navigator.clipboard.writeText(newKey).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate key");
    } finally {
      setIsRotating(false);
    }
  };

  // Rotate an existing key - uses backend rotation endpoint to keep same connection ID
  const handleRotateKey = async (connection: Connection) => {
    // If user has PIN, prompt for it to encrypt the new key
    if (hasPin) {
      setPendingEncryptAction({ type: "rotate", connection });
      setIsEncryptDialogOpen(true);
    } else {
      // No PIN - rotate without encryption
      await doRotateKey(connection);
    }
  };

  // Handler for when PIN is submitted in the encrypt dialog
  const handleEncryptWithPin = async (pin: string) => {
    if (!pendingEncryptAction) return;

    setIsEncryptDialogOpen(false);

    if (pendingEncryptAction.type === "create") {
      await doCreateConnection(pin);
    } else if (pendingEncryptAction.type === "rotate" && pendingEncryptAction.connection) {
      await doRotateKey(pendingEncryptAction.connection, pin);
    }

    setPendingEncryptAction(null);
  };

  // Generate/reveal key for a connection - also uses rotation endpoint
  // This is called when user wants to see their key but it's not in session
  const handleGenerateNewKey = async (connection: Connection) => {
    // Just call handleRotateKey - rotation generates a new key for the SAME connection
    await handleRotateKey(connection);
  };

  // Get the API key to use in config - respects visibility toggle
  const getQuickConnectDisplayKey = () => {
    if (!quickConnectApiKey) return "<YOUR_API_KEY>";
    return showQuickConnectKey ? quickConnectApiKey : maskApiKey(quickConnectApiKey);
  };

  // Handle reveal key flow - if user has PIN, verify first, otherwise prompt to set PIN
  const handleRevealKey = (connection: Connection) => {
    if (hasPin) {
      setKeyToReveal({ id: connection.id, name: connection.name });
      setIsVerifyPinDialogOpen(true);
    } else {
      // No PIN set - prompt to set one
      setKeyToReveal({ id: connection.id, name: connection.name });
      setIsSetPinDialogOpen(true);
    }
  };

  // Handler called when user clicks "Regenerate Key" button
  const handleRegenerateClick = (connection: Connection) => {
    isRegeneratingRef.current = true; // Set ref immediately (synchronous)
    setConnectionToRegenerate(connection);
    setShowRegenerateWarning(true);
  };

  // After user acknowledges warning, proceed with regeneration
  // NOTE: For pre-PIN keys, we skip PIN verification and go directly to rotation
  // because the old key wasn't encrypted with the PIN anyway
  const handleProceedWithRegenerate = () => {
    if (!connectionToRegenerate) return;

    setShowRegenerateWarning(false);

    // Skip PIN verification for pre-PIN key regeneration
    // The warning dialog already serves as confirmation
    handleRotateKey(connectionToRegenerate);

    // Clean up state
    setIsRegenerateAction(false);
    setConnectionToRegenerate(null);
    isRegeneratingRef.current = false;
  };

  // Called when PIN is verified and key is revealed
  const handleKeyRevealed = (apiKey: string) => {
    if (isRegenerateAction && connectionToRegenerate) {
      // This was a regenerate action - call rotation instead of just revealing
      handleRotateKey(connectionToRegenerate);
      setIsRegenerateAction(false);
      setConnectionToRegenerate(null);
      setKeyToReveal(null);
      isRegeneratingRef.current = false; // Reset ref after successful regeneration
      return;
    }

    // Normal reveal flow
    setQuickConnectApiKey(apiKey);
    // Also store it as the active key for this connection
    if (keyToReveal) {
      setNewKeySecret(apiKey);
      setNewKeyConnectionId(keyToReveal.id);
    }
    toast.success("API key revealed successfully!");
    setKeyToReveal(null);
  };

  // Handle when verify dialog is closed without revealing (cancelled)
  const handleVerifyDialogClose = (open: boolean) => {
    setIsVerifyPinDialogOpen(open);
    if (!open) {
      // Reset regenerate state if dialog was cancelled
      // Use ref (not state) to check because state update may not have processed yet
      setIsRegenerateAction(false);
      if (!isRegeneratingRef.current) {
        setConnectionToRegenerate(null);
      }
    }
  };

  // Called when user sets a new PIN for the first time
  const handlePinSetSuccess = () => {
    // After setting PIN, now open verify dialog to reveal the key
    if (keyToReveal) {
      setIsVerifyPinDialogOpen(true);
    }
  };

  // Handler for when VerifyPinDialog detects a pre-PIN key that cannot be revealed
  const handleNeedsRegeneration = () => {
    if (!keyToReveal) {
      return;
    }

    // Find the connection from our list
    const connection = connectionList.find(c => c.id === keyToReveal.id);

    if (connection) {
      // Show the regenerate warning dialog to confirm the action
      handleRegenerateClick(connection);
    }
  };

  const handleCopy = (text: string, label = "Copied to clipboard") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  };

  const handleDeleteClick = (connection: Connection) => {
    setConnectionToDelete(connection);
    setShowDeleteConfirmation(true);
  };

  const handleConfirmDelete = async () => {
    if (!connectionToDelete) return;

    try {
      await revokeApiKey.mutateAsync(connectionToDelete.id);
      toast.success("Connection deleted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete connection");
    } finally {
      setShowDeleteConfirmation(false);
      setConnectionToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
    setConnectionToDelete(null);
  };

  // Open edit dialog with connection data
  const handleOpenEdit = (connection: Connection) => {
    setEditConnection(connection);
    setEditName(connection.name);
    setEditMcpAccessMode((connection.mcp_access_mode as MCPAccessMode) || "all");
    setEditSelectedMcpIds(connection.allowed_mcp_ids || []);
    setEditExpirationDate(connection.expires_at ? new Date(connection.expires_at) : undefined);
  };

  // Close edit dialog
  const handleCloseEdit = () => {
    setEditConnection(null);
    setEditName("");
    setEditMcpAccessMode("all");
    setEditSelectedMcpIds([]);
    setEditExpirationDate(undefined);
  };

  // Save edited connection
  const handleSaveEdit = async () => {
    if (!editConnection) return;

    if (!editName.trim()) {
      toast.error("Connection name is required");
      return;
    }

    try {
      await updateApiKey.mutateAsync({
        keyId: editConnection.id,
        data: {
          name: editName.trim(),
          mcp_access_mode: editMcpAccessMode,
          allowed_mcp_ids: editMcpAccessMode === "selected" ? editSelectedMcpIds : undefined,
          // Send expiration: ISO string if set, empty string to clear
          expires_at: editExpirationDate ? editExpirationDate.toISOString() : "",
        },
      });
      toast.success("Connection updated successfully");
      handleCloseEdit();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update connection");
    }
  };

  // Toggle MCP selection in edit dialog
  const handleEditMcpToggle = (mcpId: string, checked: boolean) => {
    if (checked) {
      setEditSelectedMcpIds([...editSelectedMcpIds, mcpId]);
    } else {
      setEditSelectedMcpIds(editSelectedMcpIds.filter(id => id !== mcpId));
    }
  };

  const formatRelativeTime = (dateString?: string | null) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    // Check if date is invalid (NaN)
    if (isNaN(date.getTime())) return "Never";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const handleMcpToggle = (mcpId: string, checked: boolean) => {
    if (checked) {
      setSelectedMcpIds([...selectedMcpIds, mcpId]);
    } else {
      setSelectedMcpIds(selectedMcpIds.filter(id => id !== mcpId));
    }
  };

  const goToNextStep = () => {
    if (wizardStep === 1) {
      if (!connectionName) {
        toast.error("Please enter a connection name");
        return;
      }
      if (mcpAccessMode === "selected") {
        setWizardStep(2);
      } else {
        // Skip step 2 if not selecting specific MCPs
        handleCreateConnection();
      }
    } else if (wizardStep === 2) {
      if (selectedMcpIds.length === 0) {
        toast.error("Please select at least one MCP");
        return;
      }
      handleCreateConnection();
    }
  };

  const goToPreviousStep = () => {
    if (wizardStep === 2) {
      setWizardStep(1);
    }
  };

  // Loading state
  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || isLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-36 mb-2" />
            <Skeleton className="h-5 w-72" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-12 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-6 w-40 mb-2" />
                <Skeleton className="h-4 w-32 mb-4" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // No organization state - if user is null, they're signing out or not logged in - show loading
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
        <Link2 className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Link2 className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Error Loading Connections</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  const connectionList = apiKeys ?? [];
  const mcpList = mcps ?? [];

  // Calculate usage metrics
  const usagePercentage = getUsagePercentage(connectionList.length, connectionLimit);
  const remaining = isUnlimited ? null : connectionLimit - connectionList.length;

  // Helper to check connection expiration status
  const isExpired = (expiresAt: string | null | undefined): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  };

  const isExpiringSoon = (expiresAt: string | null | undefined, days: number = 7): boolean => {
    if (!expiresAt) return false;
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    return msUntilExpiry > 0 && msUntilExpiry < days * 86400000;
  };

  // Calculate expired connections (already past expiration date)
  const expiredCount = connectionList.filter((k) => isExpired(k.expires_at)).length;

  // Calculate expiring connections (within 30 days but not yet expired)
  const expiringCount = connectionList.filter((k) => isExpiringSoon(k.expires_at, 30)).length;

  // Connections expiring within 7 days (for urgent warning)
  const expiringSoon = connectionList.filter((k) => isExpiringSoon(k.expires_at, 7)).length;

  // Active connections (not expired)
  const activeCount = connectionList.length - expiredCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Connections</h1>
          <p className="text-muted-foreground">
            Create connections to access your MCPs from AI clients
          </p>
        </div>
        <Button onClick={handleOpenDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Add Connection
        </Button>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className={wizardStep === 3 ? "max-w-2xl" : "max-w-lg"}>
            {/* Step 1: Name & Access Mode */}
            {wizardStep === 1 && (
              <>
                <DialogHeader>
                  <DialogTitle>Create Connection</DialogTitle>
                  <DialogDescription>
                    Step 1 of {mcpAccessMode === "selected" ? "3" : "2"}: Name your connection and choose MCP access
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Connection Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., My Claude Desktop"
                      value={connectionName}
                      onChange={(e) => setConnectionName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      A friendly name to identify this connection
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Expiration (optional)</Label>
                    <DatePicker
                      date={expirationDate}
                      onDateChange={setExpirationDate}
                      placeholder="No expiration"
                    />
                    <p className="text-xs text-muted-foreground">
                      Connection will stop working after this date
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label>MCP Access</Label>
                    <RadioGroup
                      value={mcpAccessMode}
                      onValueChange={(value) => setMcpAccessMode(value as MCPAccessMode)}
                      className="space-y-3"
                    >
                      <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer">
                        <RadioGroupItem value="all" id="all" className="mt-0.5" />
                        <div className="flex-1">
                          <Label htmlFor="all" className="font-medium cursor-pointer flex items-center gap-2">
                            <Unlock className="h-4 w-4" />
                            All MCPs
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Access all your current and future MCPs
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer">
                        <RadioGroupItem value="selected" id="selected" className="mt-0.5" />
                        <div className="flex-1">
                          <Label htmlFor="selected" className="font-medium cursor-pointer flex items-center gap-2">
                            <Lock className="h-4 w-4" />
                            Select MCPs
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Choose specific MCPs for this connection
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button onClick={goToNextStep} disabled={createApiKey.isPending}>
                    {mcpAccessMode === "selected" ? (
                      <>
                        Next: Select MCPs
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </>
                    ) : createApiKey.isPending ? (
                      "Creating..."
                    ) : (
                      "Create Connection"
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}

            {/* Step 2: Select MCPs */}
            {wizardStep === 2 && (
              <>
                <DialogHeader>
                  <DialogTitle>Select MCPs</DialogTitle>
                  <DialogDescription>
                    Step 2 of 3: Choose which MCPs this connection can access
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  {mcpList.length === 0 ? (
                    <div className="text-center py-8">
                      <Server className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-4">
                        You don&apos;t have any MCPs yet
                      </p>
                      <Button variant="outline" asChild>
                        <Link href="/mcps">Add MCPs First</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {mcpList.map((mcp: MCP) => (
                        <div
                          key={mcp.id}
                          className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer"
                          onClick={() => handleMcpToggle(mcp.id, !selectedMcpIds.includes(mcp.id))}
                        >
                          <Checkbox
                            id={mcp.id}
                            checked={selectedMcpIds.includes(mcp.id)}
                            onCheckedChange={(checked) => handleMcpToggle(mcp.id, checked as boolean)}
                          />
                          <div className="flex-1 min-w-0">
                            <Label htmlFor={mcp.id} className="font-medium cursor-pointer">
                              {mcp.name}
                            </Label>
                            {mcp.description && (
                              <p className="text-sm text-muted-foreground truncate">
                                {mcp.description}
                              </p>
                            )}
                          </div>
                          <Badge variant={mcp.is_active ? "default" : "secondary"}>
                            {mcp.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {mcpList.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-3">
                      {selectedMcpIds.length} MCP{selectedMcpIds.length !== 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={goToPreviousStep}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={goToNextStep}
                    disabled={selectedMcpIds.length === 0 || createApiKey.isPending}
                  >
                    {createApiKey.isPending ? "Creating..." : "Create Connection"}
                  </Button>
                </DialogFooter>
              </>
            )}

            {/* Step 3: Setup Instructions */}
            {wizardStep === 3 && newKeySecret && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-green-600">
                    <Check className="h-5 w-5" />
                    Connection Created Successfully
                  </DialogTitle>
                  <DialogDescription>
                    Your connection &quot;{connectionName}&quot; is ready to use.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Info Banner */}
                  <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
                    <Info className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-green-800 dark:text-green-200">
                      <strong>Your API key is saved</strong> — you can close this dialog and reopen it anytime to view your key. Click &quot;Create New Connection&quot; when you&apos;re ready to start fresh.
                    </p>
                  </div>

                  {/* API Key Display */}
                  <div className="space-y-2">
                    <Label>Your API Key</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted p-3 rounded-md text-sm font-mono break-all">
                        {showApiKey ? newKeySecret : maskApiKey(newKeySecret)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowApiKey(!showApiKey)}
                        title={showApiKey ? "Hide key" : "Show key"}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(newKeySecret, "API key copied")}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Copy Key
                      </Button>
                    </div>
                  </div>

                  {/* Config Generator */}
                  <div className="border-t pt-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Settings className="h-5 w-5" />
                      <span className="font-semibold">Setup Instructions</span>
                    </div>

                    <Tabs defaultValue="claude" className="w-full">
                      <TabsList className="grid w-full grid-cols-5">
                        <TabsTrigger value="claude" className="text-xs px-2">Claude</TabsTrigger>
                        <TabsTrigger value="vscode" className="text-xs px-2">VS Code</TabsTrigger>
                        <TabsTrigger value="cursor" className="text-xs px-2">Cursor</TabsTrigger>
                        <TabsTrigger value="chatgpt" className="text-xs px-2">ChatGPT</TabsTrigger>
                        <TabsTrigger value="http" className="text-xs px-2">HTTP</TabsTrigger>
                      </TabsList>

                      {Object.entries(clientInfo).map(([key, info]) => (
                        <TabsContent key={key} value={key} className="mt-4 space-y-3">
                          {info.filePath && (
                            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                              <span className="font-medium">Config file:</span>{" "}
                              {info.filePath.mac || info.filePath.workspace || info.filePath.global}
                            </div>
                          )}
                          <p className="text-sm text-muted-foreground">{info.instructions}</p>
                          <div className="relative">
                            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-48 whitespace-pre-wrap break-words">
                              <code>{info.getConfig(showApiKey ? newKeySecret : maskApiKey(newKeySecret))}</code>
                            </pre>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="absolute top-2 right-2"
                              onClick={() => handleCopy(info.getConfig(newKeySecret), "Config copied")}
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              Copy
                            </Button>
                          </div>
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2 pt-4 border-t">
                  <Button variant="outline" asChild className="w-full sm:w-auto">
                    <Link href="/mcps">
                      <Server className="mr-2 h-4 w-4" />
                      Manage MCPs
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { handleClearAndStartNew(); }}
                    className="w-full sm:w-auto"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Connection
                  </Button>
                  <Button onClick={handleCloseDialog} className="w-full sm:w-auto">
                    Done
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Quick Connect Dialog */}
        <Dialog open={!!quickConnectConnection} onOpenChange={(open) => !open && handleCloseQuickConnect()}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Connect: {quickConnectConnection?.name}
              </DialogTitle>
              <DialogDescription>
                Get configuration for your AI client with your API key.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
              {/* API Key Display/Rotate Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Your API Key</Label>
                  {/* Only show Regenerate button when key is already visible */}
                  {quickConnectApiKey && quickConnectConnection && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRegenerateClick(quickConnectConnection)}
                      disabled={isRotating}
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${isRotating ? "animate-spin" : ""}`} />
                      {isRotating ? "Regenerating..." : "Regenerate Key"}
                    </Button>
                  )}
                </div>

                {quickConnectApiKey ? (
                  <>
                    {/* Info Banner for available key */}
                    <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
                      <Info className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-green-800 dark:text-green-200">
                        <strong>Your API key is available below.</strong> Copy it or use the configs with your actual key included.
                      </p>
                    </div>
                    {/* Key Display */}
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted p-3 rounded-md text-sm font-mono overflow-hidden" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                        {showQuickConnectKey ? quickConnectApiKey : maskApiKey(quickConnectApiKey)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowQuickConnectKey(!showQuickConnectKey)}
                        title={showQuickConnectKey ? "Hide key" : "Show key"}
                      >
                        {showQuickConnectKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(quickConnectApiKey, "API key copied")}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Info Banner - user has PIN and needs to reveal their existing key */}
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex flex-col items-center gap-3">
                      <Lock className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                      <div className="text-center">
                        <p className="font-medium text-blue-800 dark:text-blue-200">Your API key is protected</p>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          Click the button below and enter your 4-digit PIN to view your API key.
                        </p>
                      </div>
                      {quickConnectConnection && (
                        <Button
                          onClick={() => handleRevealKey(quickConnectConnection)}
                          className="mt-2"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Reveal API Key
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Config Generator Tabs */}
              <div className="border-t pt-4">
                <Tabs defaultValue="claude" className="w-full">
                  <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="claude" className="text-xs px-2">Claude</TabsTrigger>
                    <TabsTrigger value="vscode" className="text-xs px-2">VS Code</TabsTrigger>
                    <TabsTrigger value="cursor" className="text-xs px-2">Cursor</TabsTrigger>
                    <TabsTrigger value="chatgpt" className="text-xs px-2">ChatGPT</TabsTrigger>
                    <TabsTrigger value="http" className="text-xs px-2">HTTP</TabsTrigger>
                  </TabsList>

                  {Object.entries(clientInfo).map(([key, info]) => (
                    <TabsContent key={key} value={key} className="mt-4 space-y-3">
                      {info.filePath && (
                        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                          <span className="font-medium">Config file:</span>{" "}
                          {info.filePath.mac || info.filePath.workspace || info.filePath.global}
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">{info.instructions}</p>
                      <div className="relative">
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-48 whitespace-pre-wrap break-words">
                          <code>{info.getConfig(getQuickConnectDisplayKey())}</code>
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => handleCopy(
                            info.getConfig(quickConnectApiKey || "<YOUR_API_KEY>"),
                            "Config copied"
                          )}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </div>
            </div>
            <DialogFooter className="flex-shrink-0 border-t pt-4">
              <Button onClick={handleCloseQuickConnect}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Connection Usage Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Connection Usage</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-2xl font-bold tabular-nums">{connectionList.length}</span>
              <span className="text-muted-foreground text-sm">/ {formatLimit(connectionLimit)}</span>
            </div>
            {/* Progress Bar */}
            {!isUnlimited && (
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mb-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    getProgressBarColor(usagePercentage)
                  )}
                  style={{ width: `${Math.max(usagePercentage, 2)}%` }}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <span>
                {isUnlimited
                  ? "Unlimited connections"
                  : remaining === 0
                    ? "Limit reached"
                    : `${remaining} remaining`}
              </span>
              {subscription?.tier && (
                <Badge variant="outline" className="capitalize text-xs">
                  {subscription.tier}
                </Badge>
              )}
            </p>
          </CardContent>
        </Card>

        {/* Health Status Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Health Status</CardTitle>
            {expiredCount > 0 ? (
              <AlertCircle className="h-4 w-4 text-red-500" />
            ) : expiringSoon > 0 ? (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-2">
              <div>
                <span className="text-2xl font-bold tabular-nums text-green-500">{activeCount}</span>
                <span className="text-xs text-muted-foreground ml-1">Active</span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <span className={cn(
                  "text-2xl font-bold tabular-nums",
                  expiredCount > 0 ? "text-red-500" : "text-muted-foreground"
                )}>{expiredCount}</span>
                <span className="text-xs text-muted-foreground ml-1">Expired</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {expiredCount > 0
                ? `${expiredCount} connection${expiredCount > 1 ? "s" : ""} expired and need attention`
                : expiringSoon > 0
                  ? `${expiringSoon} connection${expiringSoon > 1 ? "s" : ""} expiring within 7 days`
                  : expiringCount > 0
                    ? `${expiringCount} connection${expiringCount > 1 ? "s" : ""} expiring within 30 days`
                    : "All connections healthy"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Connections Grid */}
      {connectionList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Link2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No connections yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Create a connection to start using your MCPs with Claude, VS Code, Cursor, and other AI clients.
            </p>
            <Button onClick={handleOpenDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first connection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectionList.map((connection) => {
            const connectionExpired = isExpired(connection.expires_at);
            return (
            <Card
              key={connection.id}
              className={cn(
                "hover:shadow-md transition-shadow",
                connectionExpired && "border-red-500 bg-red-50/50 dark:bg-red-950/20"
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{connection.name}</CardTitle>
                      {connectionExpired && (
                        <Badge variant="destructive" className="text-xs">Expired</Badge>
                      )}
                    </div>
                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {connection.key_prefix}...
                    </code>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openQuickConnect(connection)}>
                        <Settings className="mr-2 h-4 w-4" />
                        View Config
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleRevealKey(connection)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Reveal API Key
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleCopy(connection.key_prefix, "Key prefix copied")}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Key Prefix
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleOpenEdit(connection)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Connection
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleRegenerateClick(connection)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Regenerate Key
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDeleteClick(connection)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Connection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {(!connection.mcp_access_mode || connection.mcp_access_mode === "all") ? (
                    <>
                      <Unlock className="h-4 w-4" />
                      <span>All MCPs</span>
                    </>
                  ) : connection.mcp_access_mode === "selected" ? (
                    <>
                      <Lock className="h-4 w-4" />
                      <span>{connection.allowed_mcp_ids?.length ?? 0} MCPs selected</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">No MCP access</span>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last used</span>
                  <span>{formatRelativeTime(connection.last_used_at)}</span>
                </div>
                {connection.expires_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{connectionExpired ? "Expired" : "Expires"}</span>
                    <span className={cn(
                      connectionExpired
                        ? "text-red-500 font-medium"
                        : isExpiringSoon(connection.expires_at, 7) && "text-amber-500 font-medium"
                    )}>
                      {new Date(connection.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
                <div className="flex gap-1 flex-wrap">
                  {(connection.scopes || []).map((scope) => (
                    <Badge key={scope} variant="secondary" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
                {/* Quick Connect Button or Expired Actions */}
                <div className="pt-3 border-t">
                  {connectionExpired ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleOpenEdit(connection)}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Extend
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDeleteClick(connection)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => openQuickConnect(connection)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Connect
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
          })}
        </div>
      )}

      {/* Regenerate Warning Dialog */}
      <Dialog open={showRegenerateWarning} onOpenChange={setShowRegenerateWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              Regenerate API Key?
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Warning: This will immediately invalidate your current API key.
                </p>
                <ul className="mt-2 text-sm text-amber-700 dark:text-amber-300 space-y-1">
                  <li>- All existing connections using this key will stop working</li>
                  <li>- You&apos;ll need to update your API key in all clients</li>
                  <li>- This action cannot be undone</li>
                </ul>
              </div>
              <p className="text-sm">
                Click &quot;Continue&quot; to enter your PIN and regenerate the key for &quot;{connectionToRegenerate?.name}&quot;.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              isRegeneratingRef.current = false;
              setConnectionToRegenerate(null);
              setShowRegenerateWarning(false);
            }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleProceedWithRegenerate}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirmation} onOpenChange={(open) => !open && handleCancelDelete()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Connection?
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="font-medium text-red-800 dark:text-red-200">
                  This will permanently delete the connection &quot;{connectionToDelete?.name}&quot;.
                </p>
                <ul className="mt-2 text-sm text-red-700 dark:text-red-300 space-y-1">
                  <li>- The API key will be immediately revoked</li>
                  <li>- All clients using this key will lose access</li>
                  <li>- This action cannot be undone</li>
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={revokeApiKey.isPending}
            >
              {revokeApiKey.isPending ? "Deleting..." : "Delete Connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Dialog - Connection Limit Reached */}
      <Dialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-500" />
              Connection Limit Reached
            </DialogTitle>
            <DialogDescription className="pt-2">
              You&apos;ve reached the maximum of {connectionLimit} connection{connectionLimit !== 1 ? "s" : ""} on the {subscription?.tier || "free"} plan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="h-6 w-6 text-purple-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-purple-900 dark:text-purple-100">
                    Upgrade to unlock more connections
                  </p>
                  <ul className="mt-2 text-sm text-purple-700 dark:text-purple-300 space-y-1">
                    <li>- <strong>Pro:</strong> Up to 20 connections</li>
                    <li>- <strong>Team:</strong> Up to 50 connections</li>
                    <li>- <strong>Enterprise:</strong> Unlimited connections</li>
                  </ul>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Each connection allows a different AI client (Claude, VS Code, Cursor, etc.) to access your MCPs with its own API key.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsUpgradeDialogOpen(false)} className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Connection Dialog */}
      <Dialog open={!!editConnection} onOpenChange={(open) => !open && handleCloseEdit()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Connection</DialogTitle>
            <DialogDescription>
              Update the connection name and MCP access settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Connection Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-connection-name">Connection Name</Label>
              <Input
                id="edit-connection-name"
                placeholder="e.g., Claude Desktop, VS Code"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            {/* Expiration Date */}
            <div className="space-y-2">
              <Label>Expiration (optional)</Label>
              <DatePicker
                date={editExpirationDate}
                onDateChange={setEditExpirationDate}
                placeholder="No expiration"
              />
              <p className="text-xs text-muted-foreground">
                Connection will stop working after this date
              </p>
            </div>

            {/* MCP Access Mode */}
            <div className="space-y-2">
              <Label>MCP Access</Label>
              <RadioGroup
                value={editMcpAccessMode}
                onValueChange={(value) => setEditMcpAccessMode(value as MCPAccessMode)}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="edit-all" />
                  <Label htmlFor="edit-all" className="font-normal cursor-pointer">
                    Access all MCPs (current and future)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="selected" id="edit-selected" />
                  <Label htmlFor="edit-selected" className="font-normal cursor-pointer">
                    Access only selected MCPs
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="none" id="edit-none" />
                  <Label htmlFor="edit-none" className="font-normal cursor-pointer">
                    No MCP access (proxy only)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* MCP Selection (only shown when mode is "selected") */}
            {editMcpAccessMode === "selected" && (
              <div className="space-y-2">
                <Label>Select MCPs</Label>
                <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                  {mcpList.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No MCPs available
                    </p>
                  ) : (
                    mcpList.map((mcp) => (
                      <div key={mcp.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-mcp-${mcp.id}`}
                          checked={editSelectedMcpIds.includes(mcp.id)}
                          onCheckedChange={(checked) => handleEditMcpToggle(mcp.id, !!checked)}
                        />
                        <Label
                          htmlFor={`edit-mcp-${mcp.id}`}
                          className="font-normal cursor-pointer flex-1"
                        >
                          {mcp.name}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
                {editMcpAccessMode === "selected" && editSelectedMcpIds.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Please select at least one MCP
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseEdit}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateApiKey.isPending || (editMcpAccessMode === "selected" && editSelectedMcpIds.length === 0)}
            >
              {updateApiKey.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIN Dialogs */}
      <SetPinDialog
        open={isSetPinDialogOpen}
        onOpenChange={setIsSetPinDialogOpen}
        onSuccess={handlePinSetSuccess}
      />

      {keyToReveal && (
        <VerifyPinDialog
          open={isVerifyPinDialogOpen}
          onOpenChange={handleVerifyDialogClose}
          keyId={keyToReveal.id}
          keyName={keyToReveal.name}
          onReveal={handleKeyRevealed}
          onNeedsRegeneration={handleNeedsRegeneration}
        />
      )}

      <EncryptWithPinDialog
        open={isEncryptDialogOpen}
        onOpenChange={(open) => {
          setIsEncryptDialogOpen(open);
          if (!open) {
            setPendingEncryptAction(null);
          }
        }}
        onSubmit={handleEncryptWithPin}
        actionType={pendingEncryptAction?.type ?? "create"}
        keyName={pendingEncryptAction?.connection?.name}
        isLoading={createApiKey.isPending || isRotating}
      />
    </div>
  );
}

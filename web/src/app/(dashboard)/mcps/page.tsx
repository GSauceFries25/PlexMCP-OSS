"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Server, MoreHorizontal, Pencil, Trash2, ExternalLink, Power, PowerOff, HelpCircle, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Activity, Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { useMCPs, useCreateMCP, useUpdateMCP, useDeleteMCP, useTestMCPConnection, useSubscription } from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import type { MCPHealthCheckDetails } from "@/lib/api/client";

// MCP type options with descriptions
const MCP_TYPES = [
  { value: "http", label: "HTTP/REST API", description: "Connect to REST APIs over HTTP/HTTPS" },
  { value: "stdio", label: "Stdio (Local)", description: "Local process via standard input/output" },
  { value: "websocket", label: "WebSocket", description: "Real-time bidirectional connection" },
  { value: "custom", label: "Custom", description: "Custom protocol configuration" },
] as const;

// Authentication type options
const AUTH_TYPES = [
  { value: "none", label: "None", description: "No authentication required" },
  { value: "bearer", label: "Bearer Token", description: "OAuth/JWT token in Authorization header" },
  { value: "api-key", label: "API Key", description: "API key in custom header (e.g., X-API-Key)" },
  { value: "basic", label: "Basic Auth", description: "Username and password authentication" },
] as const;

// MCP limits per tier
const getMcpTierLimit = (tier: string | undefined): number => {
  switch (tier?.toLowerCase()) {
    case "free":
      return 5;
    case "pro":
      return 20;
    case "team":
      return 50;
    case "enterprise":
      return Infinity;
    default:
      return 5; // Default to free tier
  }
};

// Get the next tier name for upgrade messaging
const getNextTier = (currentTier: string | undefined): string | null => {
  switch (currentTier?.toLowerCase()) {
    case "free":
      return "Pro";
    case "pro":
      return "Team";
    case "team":
    case "enterprise":
      return null; // No upgrade needed
    default:
      return "Pro";
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

// Help content for form fields
const HELP_CONTENT = {
  name: "A friendly name to identify this MCP. Example: 'Weather Service' or 'Database Tools'",
  mcp_type: "Select how PlexMCP connects to your service. HTTP/REST is most common for external APIs.",
  endpoint_url: "The URL where your MCP server is running. Must be HTTPS in production for security.",
  auth_type: "How to authenticate with this MCP. Most remote MCPs use Bearer Token.",
  api_key: "The token or API key value. Stored securely and never exposed in API responses.",
  api_key_header: "The HTTP header name for the API key. Common values: X-API-Key, Authorization, Api-Key",
  username: "Username for Basic authentication.",
  password: "Password for Basic authentication.",
  description: "Optional notes about this MCP's purpose, owner, or configuration details.",
};

export default function MCPsPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync, user } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: mcps, isLoading, error } = useMCPs(organizationId);
  const { data: subscription } = useSubscription(organizationId);
  const createMCP = useCreateMCP(organizationId);
  const updateMCP = useUpdateMCP(organizationId);
  const deleteMCP = useDeleteMCP(organizationId);
  const testMCP = useTestMCPConnection(organizationId);

  // Calculate MCP limits based on subscription tier
  const mcpLimit = getMcpTierLimit(subscription?.tier);
  const currentMcpCount = mcps?.length ?? 0;
  const isAtMcpLimit = currentMcpCount >= mcpLimit;
  const nextTier = getNextTier(subscription?.tier);
  const usagePercentage = getUsagePercentage(currentMcpCount, mcpLimit);
  const isUnlimited = mcpLimit === Infinity;
  const remaining = isUnlimited ? null : mcpLimit - currentMcpCount;

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingMCP, setEditingMCP] = useState<{
    id: string;
    name: string;
    endpoint_url: string;
    auth_type: string;
    api_key: string;
    api_key_header: string;
    username: string;
    password: string;
    description: string;
    is_active: boolean;
  } | null>(null);
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [testingMcpId, setTestingMcpId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; details?: MCPHealthCheckDetails }>>({});
  const [newMCP, setNewMCP] = useState({
    name: "",
    mcp_type: "http",
    endpoint_url: "",
    auth_type: "bearer",
    api_key: "",
    api_key_header: "X-API-Key",
    username: "",
    password: "",
    description: "",
  });

  // Helper to get endpoint URL from MCP (checks both top-level and config)
  const getEndpointUrl = (mcp: { endpoint_url?: string; config?: unknown }): string => {
    if (mcp.endpoint_url) return mcp.endpoint_url;
    if (mcp.config && typeof mcp.config === "object" && mcp.config !== null) {
      const config = mcp.config as Record<string, unknown>;
      if (typeof config.endpoint_url === "string") return config.endpoint_url;
    }
    return "";
  };

  const handleAddMCP = async () => {
    if (!newMCP.name || !newMCP.mcp_type) {
      toast.error("Name and MCP type are required");
      return;
    }

    // Require endpoint URL/command for all types
    if (!newMCP.endpoint_url) {
      const fieldName = newMCP.mcp_type === "stdio" ? "Command" :
                        newMCP.mcp_type === "websocket" ? "WebSocket URL" : "Endpoint URL";
      toast.error(`${fieldName} is required`);
      return;
    }

    try {
      // Build config object with endpoint URL and auth
      const config: Record<string, unknown> = {};
      if (newMCP.endpoint_url) {
        config.endpoint_url = newMCP.endpoint_url;
      }

      // Add auth config based on type
      config.auth_type = newMCP.auth_type;
      switch (newMCP.auth_type) {
        case "bearer":
          if (newMCP.api_key) {
            config.api_key = newMCP.api_key;
          }
          break;
        case "api-key":
          if (newMCP.api_key) {
            config.api_key = newMCP.api_key;
            config.api_key_header = newMCP.api_key_header || "X-API-Key";
          }
          break;
        case "basic":
          if (newMCP.username) {
            config.username = newMCP.username;
            config.password = newMCP.password;
          }
          break;
        case "none":
        default:
          // No auth needed
          break;
      }

      await createMCP.mutateAsync({
        name: newMCP.name,
        mcp_type: newMCP.mcp_type,
        description: newMCP.description || undefined,
        is_active: true, // Auto-activate MCPs when created
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      setNewMCP({
        name: "",
        mcp_type: "http",
        endpoint_url: "",
        auth_type: "bearer",
        api_key: "",
        api_key_header: "X-API-Key",
        username: "",
        password: "",
        description: ""
      });
      setShowApiKey(false);
      setShowPassword(false);
      setIsAddDialogOpen(false);
      toast.success("MCP added successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add MCP");
    }
  };

  // Helper component for field label with help tooltip
  const FieldLabel = ({ htmlFor, label, helpKey }: { htmlFor: string; label: string; helpKey: keyof typeof HELP_CONTENT }) => (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{HELP_CONTENT[helpKey]}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );

  const handleToggleActive = async (id: string, currentlyActive: boolean) => {
    try {
      await updateMCP.mutateAsync({
        mcpId: id,
        data: { is_active: !currentlyActive },
      });
      toast.success(`MCP ${currentlyActive ? "deactivated" : "activated"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update MCP");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMCP.mutateAsync(id);
      toast.success("MCP deleted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete MCP");
    }
  };

  // Helper to get config field from MCP
  const getConfigField = (mcp: { config?: unknown }, field: string, defaultValue: string = ""): string => {
    if (mcp.config && typeof mcp.config === "object" && mcp.config !== null) {
      const config = mcp.config as Record<string, unknown>;
      if (typeof config[field] === "string") return config[field] as string;
    }
    return defaultValue;
  };

  const handleOpenEdit = (mcp: { id: string; name: string; endpoint_url?: string; config?: unknown; description?: string | null; is_active: boolean }) => {
    setEditingMCP({
      id: mcp.id,
      name: mcp.name,
      endpoint_url: getEndpointUrl(mcp),
      auth_type: getConfigField(mcp, "auth_type", "bearer"),
      api_key: getConfigField(mcp, "api_key"),
      api_key_header: getConfigField(mcp, "api_key_header", "X-API-Key"),
      username: getConfigField(mcp, "username"),
      password: getConfigField(mcp, "password"),
      description: mcp.description || "",
      is_active: mcp.is_active,
    });
    setShowEditApiKey(false);
    setShowEditPassword(false);
    setIsEditDialogOpen(true);
  };

  const handleEditMCP = async () => {
    if (!editingMCP) return;

    try {
      // Build config object with endpoint URL and auth
      const config: Record<string, unknown> = {};
      if (editingMCP.endpoint_url) {
        config.endpoint_url = editingMCP.endpoint_url;
      }

      // Add auth config based on type
      config.auth_type = editingMCP.auth_type;
      switch (editingMCP.auth_type) {
        case "bearer":
          if (editingMCP.api_key) {
            config.api_key = editingMCP.api_key;
          }
          break;
        case "api-key":
          if (editingMCP.api_key) {
            config.api_key = editingMCP.api_key;
            config.api_key_header = editingMCP.api_key_header || "X-API-Key";
          }
          break;
        case "basic":
          if (editingMCP.username) {
            config.username = editingMCP.username;
            config.password = editingMCP.password;
          }
          break;
        case "none":
        default:
          // No auth needed
          break;
      }

      await updateMCP.mutateAsync({
        mcpId: editingMCP.id,
        data: {
          name: editingMCP.name,
          description: editingMCP.description || undefined,
          is_active: editingMCP.is_active,
          config: Object.keys(config).length > 0 ? config : undefined,
        },
      });
      toast.success("MCP updated successfully");
      setIsEditDialogOpen(false);
      setEditingMCP(null);
      setShowEditApiKey(false);
      setShowEditPassword(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update MCP");
    }
  };

  const handleTestConnection = async (mcp: { id: string; endpoint_url?: string; config?: unknown; name: string }) => {
    setTestingMcpId(mcp.id);
    // Clear previous result for this MCP
    setTestResults(prev => {
      const newResults = { ...prev };
      delete newResults[mcp.id];
      return newResults;
    });

    try {
      // Call the backend health check endpoint which tests the MCP connection
      const result = await testMCP.mutateAsync(mcp.id);

      if (result.health_status === "healthy") {
        const toolsCount = result.details.tools_count ?? 0;
        const message = `${toolsCount} tools available`;
        setTestResults(prev => ({
          ...prev,
          [mcp.id]: { success: true, message, details: result.details }
        }));
        toast.success(`${mcp.name}: Connected! ${message}`);
      } else {
        const errorMsg = result.details.error || "Connection failed";
        setTestResults(prev => ({
          ...prev,
          [mcp.id]: { success: false, message: errorMsg, details: result.details }
        }));
        toast.error(`${mcp.name}: ${errorMsg}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Connection test failed";
      setTestResults(prev => ({
        ...prev,
        [mcp.id]: { success: false, message: errorMsg }
      }));
      toast.error(`${mcp.name}: ${errorMsg}`);
    } finally {
      setTestingMcpId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || isLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-32 mb-2" />
            <Skeleton className="h-5 w-64" />
          </div>
          <Skeleton className="h-10 w-28" />
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
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
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
        <Server className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Server className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Error Loading MCPs</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  const mcpList = mcps ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">MCPs</h1>
          <p className="text-muted-foreground">
            Manage your Model Context Protocol endpoints
            {subscription?.tier && (
              <span className="ml-2 text-xs">
                <Badge variant="outline" className="ml-1 capitalize">
                  {subscription.tier} Plan
                </Badge>
              </span>
            )}
          </p>
        </div>
        {/* Add MCP Button - checks limit before opening add dialog */}
        <Button
          onClick={() => {
            if (isAtMcpLimit && nextTier) {
              setIsUpgradeDialogOpen(true);
            } else {
              setIsAddDialogOpen(true);
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add MCP
        </Button>

        {/* Add MCP Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add New MCP</DialogTitle>
              <DialogDescription>
                Connect a new Model Context Protocol endpoint to your organization.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Name Field */}
              <div className="grid gap-2">
                <FieldLabel htmlFor="name" label="Name *" helpKey="name" />
                <Input
                  id="name"
                  placeholder="e.g., Weather Service"
                  value={newMCP.name}
                  onChange={(e) => setNewMCP({ ...newMCP, name: e.target.value })}
                />
              </div>

              {/* MCP Type Dropdown */}
              <div className="grid gap-2">
                <FieldLabel htmlFor="mcp_type" label="MCP Type *" helpKey="mcp_type" />
                <Select
                  value={newMCP.mcp_type}
                  onValueChange={(value) => setNewMCP({ ...newMCP, mcp_type: value })}
                >
                  <SelectTrigger id="mcp_type">
                    <SelectValue placeholder="Select MCP type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex flex-col">
                          <span>{type.label}</span>
                          <span className="text-xs text-muted-foreground">{type.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Endpoint URL Field - shown for HTTP, WebSocket, and Custom types */}
              {(newMCP.mcp_type === "http" || newMCP.mcp_type === "websocket" || newMCP.mcp_type === "custom") && (
                <div className="grid gap-2">
                  <FieldLabel
                    htmlFor="endpoint"
                    label={newMCP.mcp_type === "websocket" ? "WebSocket URL *" : "Endpoint URL *"}
                    helpKey="endpoint_url"
                  />
                  <Input
                    id="endpoint"
                    placeholder={
                      newMCP.mcp_type === "websocket"
                        ? "wss://example.com/mcp"
                        : "https://api.example.com/mcp"
                    }
                    value={newMCP.endpoint_url}
                    onChange={(e) => setNewMCP({ ...newMCP, endpoint_url: e.target.value })}
                  />
                </div>
              )}

              {/* Command Field - shown for Stdio type */}
              {newMCP.mcp_type === "stdio" && (
                <div className="grid gap-2">
                  <FieldLabel htmlFor="endpoint" label="Command *" helpKey="endpoint_url" />
                  <Input
                    id="endpoint"
                    placeholder="npx -y @modelcontextprotocol/server-filesystem"
                    value={newMCP.endpoint_url}
                    onChange={(e) => setNewMCP({ ...newMCP, endpoint_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The command to start the local MCP server process
                  </p>
                </div>
              )}

              {/* Authentication Type */}
              <div className="grid gap-2">
                <FieldLabel htmlFor="auth_type" label="Authentication" helpKey="auth_type" />
                <Select
                  value={newMCP.auth_type}
                  onValueChange={(value) => setNewMCP({ ...newMCP, auth_type: value })}
                >
                  <SelectTrigger id="auth_type">
                    <SelectValue placeholder="Select auth type" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex flex-col">
                          <span>{type.label}</span>
                          <span className="text-xs text-muted-foreground">{type.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Bearer Token Field */}
              {newMCP.auth_type === "bearer" && (
                <div className="grid gap-2">
                  <FieldLabel htmlFor="api_key" label="Bearer Token" helpKey="api_key" />
                  <div className="relative">
                    <Input
                      id="api_key"
                      type={showApiKey ? "text" : "password"}
                      placeholder="Enter OAuth/JWT token"
                      value={newMCP.api_key}
                      onChange={(e) => setNewMCP({ ...newMCP, api_key: e.target.value })}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              )}

              {/* API Key Fields */}
              {newMCP.auth_type === "api-key" && (
                <>
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="api_key_header" label="Header Name" helpKey="api_key_header" />
                    <Input
                      id="api_key_header"
                      placeholder="X-API-Key"
                      value={newMCP.api_key_header}
                      onChange={(e) => setNewMCP({ ...newMCP, api_key_header: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="api_key" label="API Key Value" helpKey="api_key" />
                    <div className="relative">
                      <Input
                        id="api_key"
                        type={showApiKey ? "text" : "password"}
                        placeholder="Enter API key"
                        value={newMCP.api_key}
                        onChange={(e) => setNewMCP({ ...newMCP, api_key: e.target.value })}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {/* Basic Auth Fields */}
              {newMCP.auth_type === "basic" && (
                <>
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="username" label="Username" helpKey="username" />
                    <Input
                      id="username"
                      placeholder="Enter username"
                      value={newMCP.username}
                      onChange={(e) => setNewMCP({ ...newMCP, username: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="password" label="Password" helpKey="password" />
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter password"
                        value={newMCP.password}
                        onChange={(e) => setNewMCP({ ...newMCP, password: e.target.value })}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {/* Description Field */}
              <div className="grid gap-2">
                <FieldLabel htmlFor="description" label="Description" helpKey="description" />
                <Input
                  id="description"
                  placeholder="Brief description of this MCP (optional)"
                  value={newMCP.description}
                  onChange={(e) => setNewMCP({ ...newMCP, description: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsAddDialogOpen(false);
                setShowApiKey(false);
                setShowPassword(false);
                setNewMCP({
                  name: "",
                  mcp_type: "http",
                  endpoint_url: "",
                  auth_type: "bearer",
                  api_key: "",
                  api_key_header: "X-API-Key",
                  username: "",
                  password: "",
                  description: ""
                });
              }}>
                Cancel
              </Button>
              <Button onClick={handleAddMCP} disabled={createMCP.isPending}>
                {createMCP.isPending ? "Adding..." : "Add MCP"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit MCP Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) setEditingMCP(null);
        }}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Edit MCP</DialogTitle>
              <DialogDescription>
                Update the MCP configuration.
              </DialogDescription>
            </DialogHeader>
            {editingMCP && (
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editingMCP.name}
                    onChange={(e) => setEditingMCP({ ...editingMCP, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-endpoint">Endpoint URL</Label>
                  <Input
                    id="edit-endpoint"
                    placeholder="https://api.example.com/mcp"
                    value={editingMCP.endpoint_url}
                    onChange={(e) => setEditingMCP({ ...editingMCP, endpoint_url: e.target.value })}
                  />
                </div>

                {/* Authentication Type */}
                <div className="grid gap-2">
                  <FieldLabel htmlFor="edit-auth-type" label="Authentication" helpKey="auth_type" />
                  <Select
                    value={editingMCP.auth_type}
                    onValueChange={(value) => setEditingMCP({ ...editingMCP, auth_type: value })}
                  >
                    <SelectTrigger id="edit-auth-type">
                      <SelectValue placeholder="Select auth type" />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTH_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex flex-col">
                            <span>{type.label}</span>
                            <span className="text-xs text-muted-foreground">{type.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Bearer Token Field */}
                {editingMCP.auth_type === "bearer" && (
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="edit-api-key" label="Bearer Token" helpKey="api_key" />
                    <div className="relative">
                      <Input
                        id="edit-api-key"
                        type={showEditApiKey ? "text" : "password"}
                        placeholder="Enter OAuth/JWT token"
                        value={editingMCP.api_key}
                        onChange={(e) => setEditingMCP({ ...editingMCP, api_key: e.target.value })}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowEditApiKey(!showEditApiKey)}
                      >
                        {showEditApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                )}

                {/* API Key Fields */}
                {editingMCP.auth_type === "api-key" && (
                  <>
                    <div className="grid gap-2">
                      <FieldLabel htmlFor="edit-api-key-header" label="Header Name" helpKey="api_key_header" />
                      <Input
                        id="edit-api-key-header"
                        placeholder="X-API-Key"
                        value={editingMCP.api_key_header}
                        onChange={(e) => setEditingMCP({ ...editingMCP, api_key_header: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <FieldLabel htmlFor="edit-api-key" label="API Key Value" helpKey="api_key" />
                      <div className="relative">
                        <Input
                          id="edit-api-key"
                          type={showEditApiKey ? "text" : "password"}
                          placeholder="Enter API key"
                          value={editingMCP.api_key}
                          onChange={(e) => setEditingMCP({ ...editingMCP, api_key: e.target.value })}
                          className="pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowEditApiKey(!showEditApiKey)}
                        >
                          {showEditApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* Basic Auth Fields */}
                {editingMCP.auth_type === "basic" && (
                  <>
                    <div className="grid gap-2">
                      <FieldLabel htmlFor="edit-username" label="Username" helpKey="username" />
                      <Input
                        id="edit-username"
                        placeholder="Enter username"
                        value={editingMCP.username}
                        onChange={(e) => setEditingMCP({ ...editingMCP, username: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <FieldLabel htmlFor="edit-password" label="Password" helpKey="password" />
                      <div className="relative">
                        <Input
                          id="edit-password"
                          type={showEditPassword ? "text" : "password"}
                          placeholder="Enter password"
                          value={editingMCP.password}
                          onChange={(e) => setEditingMCP({ ...editingMCP, password: e.target.value })}
                          className="pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowEditPassword(!showEditPassword)}
                        >
                          {showEditPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Input
                    id="edit-description"
                    placeholder="Optional description"
                    value={editingMCP.description}
                    onChange={(e) => setEditingMCP({ ...editingMCP, description: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-active">Active</Label>
                  <Button
                    variant={editingMCP.is_active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEditingMCP({ ...editingMCP, is_active: !editingMCP.is_active })}
                  >
                    {editingMCP.is_active ? "Active" : "Inactive"}
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsEditDialogOpen(false);
                setEditingMCP(null);
                setShowEditApiKey(false);
              }}>
                Cancel
              </Button>
              <Button onClick={handleEditMCP} disabled={updateMCP.isPending}>
                {updateMCP.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upgrade Plan Dialog */}
        <Dialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                  <Crown className="h-6 w-6 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-xl">MCP Limit Reached</DialogTitle>
                  <DialogDescription>
                    You&apos;ve reached the maximum of {mcpLimit} MCPs on your {subscription?.tier || "Free"} plan.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="py-4">
              <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  <span className="font-semibold">Upgrade to {nextTier}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Get more MCPs and unlock additional features:
                </p>
                <ul className="space-y-2 text-sm">
                  {subscription?.tier?.toLowerCase() === "free" && (
                    <>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Up to 20 MCPs (vs 5 on Free)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Priority support</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Advanced analytics</span>
                      </li>
                    </>
                  )}
                  {subscription?.tier?.toLowerCase() === "pro" && (
                    <>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Up to 50 MCPs (vs 20 on Pro)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Custom domains</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-green-500" />
                        <span>Team collaboration features</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Currently using {currentMcpCount} of {mcpLimit === Infinity ? "unlimited" : mcpLimit} MCPs
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsUpgradeDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MCP Usage</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-2xl font-bold tabular-nums">{currentMcpCount}</span>
              <span className="text-muted-foreground text-sm">/ {formatLimit(mcpLimit)}</span>
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
            <p className="text-xs text-muted-foreground">
              {isUnlimited
                ? `${mcpList.filter((m) => m.is_active).length} active`
                : remaining === 0
                  ? "Limit reached"
                  : `${remaining} remaining`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active MCPs</CardTitle>
            <Power className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mcpList.filter((m) => m.is_active).length}
            </div>
            <p className="text-xs text-muted-foreground">Ready to receive requests</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Health Status</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {mcpList.filter((m) => m.is_active).length}/{mcpList.length}
            </div>
            <p className="text-xs text-muted-foreground">Healthy endpoints</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>MCP Endpoints</CardTitle>
          <CardDescription>
            All configured Model Context Protocol servers for your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcpList.map((mcp) => (
                <TableRow key={mcp.id}>
                  <TableCell>
                    <div className="font-medium">{mcp.name}</div>
                    {mcp.description && (
                      <div className="text-sm text-muted-foreground">{mcp.description}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      {getEndpointUrl(mcp) || <span className="text-muted-foreground italic">Not configured</span>}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={mcp.is_active ? "default" : "secondary"}>
                      {mcp.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(mcp.created_at)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenEdit(mcp)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleTestConnection(mcp)}
                          disabled={testingMcpId === mcp.id}
                        >
                          {testingMcpId === mcp.id ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Testing...
                            </>
                          ) : testResults[mcp.id] ? (
                            <>
                              {testResults[mcp.id].success ? (
                                <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="mr-2 h-4 w-4 text-red-500" />
                              )}
                              {testResults[mcp.id].message}
                            </>
                          ) : (
                            <>
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Test Connection
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/testing/${mcp.id}`}>
                            <Activity className="mr-2 h-4 w-4" />
                            View Test Details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleActive(mcp.id, mcp.is_active)}>
                          {mcp.is_active ? (
                            <>
                              <PowerOff className="mr-2 h-4 w-4" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <Power className="mr-2 h-4 w-4" />
                              Activate
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(mcp.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {mcpList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Server className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No MCPs configured yet</p>
                      <Button variant="outline" size="sm" onClick={() => setIsAddDialogOpen(true)}>
                        Add your first MCP
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

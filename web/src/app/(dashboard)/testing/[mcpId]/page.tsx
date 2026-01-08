"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  Zap,
  Server,
  Shield,
  Wrench,
  FileText,
  Pencil,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  RefreshCcw,
  Eye,
  EyeOff,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import {
  useMCP,
  useTestHistory,
  useValidateConfig,
  useRunHealthCheck,
  useUpdateMCP,
} from "@/lib/api/hooks";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

// Authentication type options
const AUTH_TYPES = [
  { value: "none", label: "None", description: "No authentication required" },
  { value: "bearer", label: "Bearer Token", description: "OAuth/JWT token in Authorization header" },
  { value: "api-key", label: "API Key", description: "API key in custom header (e.g., X-API-Key)" },
  { value: "basic", label: "Basic Auth", description: "Username and password authentication" },
] as const;

// Help content for form fields
const HELP_CONTENT = {
  name: "A friendly name to identify this MCP. Example: 'Weather Service' or 'Database Tools'",
  endpoint_url: "The URL where your MCP server is running. Must be HTTPS in production for security.",
  auth_type: "How to authenticate with this MCP. Most remote MCPs use Bearer Token.",
  api_key: "The token or API key value. Stored securely and never exposed in API responses.",
  api_key_header: "The HTTP header name for the API key. Common values: X-API-Key, Authorization, Api-Key",
  username: "Username for Basic authentication.",
  password: "Password for Basic authentication.",
  description: "Optional notes about this MCP's purpose, owner, or configuration details.",
};
import { cn } from "@/lib/utils";
import {
  TroubleshootingSuggestions,
  StatusTimeline,
  LatencyTrendChart,
  ExpandableHistoryRow,
} from "@/components/testing";

interface PageProps {
  params: Promise<{ mcpId: string }>;
}

export default function MCPTestPage({ params }: PageProps) {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { mcpId } = use(params);
  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: mcp, isLoading: mcpLoading, error: mcpError, refetch: refetchMcp } = useMCP(organizationId, mcpId);
  const { data: testHistory, isLoading: historyLoading, refetch: refetchHistory } = useTestHistory(organizationId, mcpId);
  const { data: validation, isLoading: validationLoading, refetch: refetchValidation } = useValidateConfig(organizationId, mcpId);
  const runHealthCheck = useRunHealthCheck(organizationId);
  const updateMCP = useUpdateMCP(organizationId);

  const [copied, setCopied] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [hasAutoDiscovered, setHasAutoDiscovered] = useState(false);

  // Edit modal state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
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

  // Auto-refresh with localStorage persistence
  const [autoRefresh, setAutoRefresh] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`autoRefresh-${mcpId}`) === 'true';
    }
    return false;
  });

  // Persist auto-refresh setting
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`autoRefresh-${mcpId}`, String(autoRefresh));
    }
  }, [autoRefresh, mcpId]);

  // Auto-discover resources on page load if not yet discovered
  useEffect(() => {
    // Only run once per page load, when MCP data is available
    if (hasAutoDiscovered || !mcp || mcpLoading || runHealthCheck.isPending) return;

    // Check if resources haven't been discovered yet
    const needsDiscovery = !mcp.resources_json ||
      (Array.isArray(mcp.resources_json) && mcp.resources_json.length === 0) ||
      !mcp.tools_json ||
      (Array.isArray(mcp.tools_json) && mcp.tools_json.length === 0);

    if (needsDiscovery) {
      setHasAutoDiscovered(true);
      // Run health check to discover resources/tools
      runHealthCheck.mutateAsync(mcpId)
        .then(() => {
          refetchMcp();
          refetchHistory();
          refetchValidation();
        })
        .catch(() => {
          // Silent fail for auto-discovery - user can manually retry
        });
    } else {
      setHasAutoDiscovered(true);
    }
  }, [mcp, mcpLoading, mcpId, hasAutoDiscovered, runHealthCheck, refetchMcp, refetchHistory, refetchValidation]);

  // Auto-refresh polling - runs health check every 60 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Run actual health check, not just refetch
      runHealthCheck.mutateAsync(mcpId)
        .then(() => {
          refetchMcp();
          refetchHistory();
        })
        .catch(() => {
          // Silent fail for auto-refresh
        });
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, mcpId, runHealthCheck, refetchMcp, refetchHistory]);

  const handleRunTest = async () => {
    try {
      await runHealthCheck.mutateAsync(mcpId);
      toast.success("Health check completed!");
      // Refetch data after test
      refetchMcp();
      refetchHistory();
      refetchValidation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Health check failed");
    }
  };

  const handleCopyUrl = async () => {
    const url = getEndpointUrl();
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  // Helper to get endpoint URL from MCP
  const getEndpointUrl = (): string => {
    if (!mcp) return "";
    if (mcp.endpoint_url) return mcp.endpoint_url;
    if (mcp.config && typeof mcp.config === "object" && mcp.config !== null) {
      const config = mcp.config as Record<string, unknown>;
      if (typeof config.endpoint_url === "string") return config.endpoint_url;
    }
    return "";
  };

  // Get auth type from MCP config
  const getAuthType = (): string => {
    if (!mcp?.config || typeof mcp.config !== "object") return "None";
    const config = mcp.config as Record<string, unknown>;
    const authType = config.auth_type;
    if (typeof authType === "string") {
      switch (authType) {
        case "bearer": return "Bearer Token";
        case "api-key": return "API Key";
        case "basic": return "Basic Auth";
        default: return "None";
      }
    }
    return "None";
  };

  // Get last error message from test history
  const getLastErrorMessage = (): string | null => {
    if (testHistory && testHistory.length > 0) {
      const lastTest = testHistory[0];
      if (lastTest.error_message) return lastTest.error_message;
    }
    return null;
  };

  // Helper to get health status display
  const getHealthStatus = (status: string) => {
    switch (status) {
      case "healthy":
        return {
          icon: <CheckCircle2 className="h-6 w-6 text-emerald-500" />,
          badge: <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-500">Healthy</Badge>,
          color: "text-emerald-500",
          bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
          borderColor: "border-emerald-200 dark:border-emerald-900",
        };
      case "unhealthy":
        return {
          icon: <XCircle className="h-6 w-6 text-red-500" />,
          badge: <Badge variant="destructive">Unhealthy</Badge>,
          color: "text-red-500",
          bgColor: "bg-red-50 dark:bg-red-950/30",
          borderColor: "border-red-200 dark:border-red-900",
        };
      default:
        return {
          icon: <AlertCircle className="h-6 w-6 text-yellow-500" />,
          badge: <Badge variant="secondary">Unknown</Badge>,
          color: "text-yellow-500",
          bgColor: "bg-yellow-50 dark:bg-yellow-950/30",
          borderColor: "border-yellow-200 dark:border-yellow-900",
        };
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

  // Helper to get config field from MCP
  const getConfigField = (field: string, defaultValue: string = ""): string => {
    if (mcp?.config && typeof mcp.config === "object" && mcp.config !== null) {
      const config = mcp.config as Record<string, unknown>;
      if (typeof config[field] === "string") return config[field] as string;
    }
    return defaultValue;
  };

  const handleOpenEdit = () => {
    if (!mcp) return;
    setEditingMCP({
      id: mcp.id,
      name: mcp.name,
      endpoint_url: getEndpointUrl(),
      auth_type: getConfigField("auth_type", "bearer"),
      api_key: getConfigField("api_key"),
      api_key_header: getConfigField("api_key_header", "X-API-Key"),
      username: getConfigField("username"),
      password: getConfigField("password"),
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
      // Refetch MCP data to reflect changes
      refetchMcp();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update MCP");
    }
  };

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || mcpLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mcpError || !mcp) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">MCP Not Found</h2>
        <p className="text-muted-foreground">
          {mcpError?.message || "The requested MCP could not be found."}
        </p>
        <Link href="/testing">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Testing
          </Button>
        </Link>
      </div>
    );
  }

  const currentStatus = getHealthStatus(mcp.health_status || "unknown");
  const endpointUrl = getEndpointUrl();
  const lastError = getLastErrorMessage();
  const lastTestedAt = testHistory?.[0]?.tested_at;

  // Check if config validation passes but MCP is unhealthy (disconnect)
  const hasDisconnect = validation?.all_passed && mcp.health_status === "unhealthy";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/testing" className="hover:text-foreground transition-colors">
          Testing
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">{mcp.name}</span>
      </nav>

      {/* Enhanced Header */}
      <div className={cn(
        "rounded-lg border p-6",
        currentStatus.bgColor,
        currentStatus.borderColor
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl",
              mcp.health_status === "healthy" ? "bg-emerald-100 dark:bg-emerald-900/50" :
              mcp.health_status === "unhealthy" ? "bg-red-100 dark:bg-red-900/50" :
              "bg-yellow-100 dark:bg-yellow-900/50"
            )}>
              <div className={cn(
                runHealthCheck.isPending && "animate-pulse"
              )}>
                {currentStatus.icon}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{mcp.name}</h1>
                {currentStatus.badge}
              </div>

              {/* Endpoint URL with copy */}
              {endpointUrl && (
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-sm text-muted-foreground bg-background/50 px-2 py-0.5 rounded max-w-md truncate">
                    {endpointUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleCopyUrl}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              {/* Last tested + latency */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {lastTestedAt && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Last tested {formatRelativeTime(lastTestedAt)}</span>
                  </div>
                )}
                {mcp.last_latency_ms && (
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    <span className={cn(
                      "font-mono",
                      mcp.last_latency_ms < 200 ? "text-emerald-600 dark:text-emerald-400" :
                      mcp.last_latency_ms < 500 ? "text-amber-600 dark:text-amber-400" :
                      "text-red-600 dark:text-red-400"
                    )}>
                      {mcp.last_latency_ms}ms
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Auto-refresh toggle */}
            <div className="flex items-center gap-2 border-r pr-3 mr-1">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => {
                  setAutoRefresh(checked);
                  if (checked) {
                    toast.success("Auto-refresh enabled", {
                      description: "Health checks will run every 60 seconds"
                    });
                  } else {
                    toast.info("Auto-refresh disabled");
                  }
                }}
              />
              <Label htmlFor="auto-refresh" className="text-xs text-muted-foreground cursor-pointer">
                Auto
              </Label>
              {autoRefresh && (
                <RefreshCcw className="h-3 w-3 text-emerald-500 animate-spin" style={{ animationDuration: "3s" }} />
              )}
            </div>

            <Button variant="outline" size="sm" onClick={handleOpenEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Configure
            </Button>
            <Button onClick={handleRunTest} disabled={runHealthCheck.isPending} size="sm">
              {runHealthCheck.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Run Test
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Error Alert with Troubleshooting */}
      <TroubleshootingSuggestions
        errorMessage={lastError}
        healthStatus={mcp.health_status || "unknown"}
        onRetry={handleRunTest}
        isRetrying={runHealthCheck.isPending}
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Config Validation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Config Validation
            </CardTitle>
            <CardDescription>
              Pre-flight checks before testing connection
            </CardDescription>
          </CardHeader>
          <CardContent>
            {validationLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-5 w-full" />
                  </div>
                ))}
              </div>
            ) : validation ? (
              <div className="space-y-3">
                {validation.validations.map((check, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-3 p-2.5 rounded-lg",
                      check.passed
                        ? "bg-emerald-50 dark:bg-emerald-950/20"
                        : "bg-red-50 dark:bg-red-950/20"
                    )}
                  >
                    {check.passed ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{check.message}</span>
                      {check.latency_ms && (
                        <span className="text-muted-foreground text-xs ml-2">
                          ({check.latency_ms}ms)
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t">
                  {validation.all_passed ? (
                    hasDisconnect ? (
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                          <div>
                            <p className="font-medium text-amber-700 dark:text-amber-300 text-sm">
                              Configuration Valid, Connection Failed
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              Your settings look correct, but we couldn&apos;t connect to the MCP server.
                              The server may be offline, unreachable, or rejecting connections.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="font-medium text-sm">All checks passed</span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <XCircle className="h-4 w-4" />
                      <span className="font-medium text-sm">Some checks failed</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Unable to load validation</p>
            )}
          </CardContent>
        </Card>

        {/* Server Info with Tabs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Server Info
            </CardTitle>
            <CardDescription>
              MCP server details from last successful test
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="tools" className="relative">
                  Tools
                  {mcp.tools_count != null && mcp.tools_count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-5 min-w-[20px] px-1.5 text-xs">
                      {mcp.tools_count}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="resources" className="relative">
                  Resources
                  {mcp.resources_count != null && mcp.resources_count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-5 min-w-[20px] px-1.5 text-xs">
                      {mcp.resources_count}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="mt-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4" />
                      Protocol
                    </span>
                    <span className="font-medium text-sm">
                      {mcp.protocol_version || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Server className="h-4 w-4" />
                      Server
                    </span>
                    <span className="font-medium text-sm">
                      {mcp.server_name || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm flex-shrink-0">
                      <FileText className="h-4 w-4" />
                      Version
                    </span>
                    <span
                      className="font-medium text-sm truncate max-w-[180px]"
                      title={mcp.server_version || undefined}
                    >
                      {mcp.server_version || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4" />
                      Auth
                    </span>
                    <span className="font-medium text-sm">{getAuthType()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4" />
                      Latency
                    </span>
                    <span
                      className={cn(
                        "font-medium font-mono text-sm",
                        mcp.last_latency_ms
                          ? mcp.last_latency_ms < 200
                            ? "text-emerald-600 dark:text-emerald-400"
                            : mcp.last_latency_ms < 500
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                          : ""
                      )}
                    >
                      {mcp.last_latency_ms ? `${mcp.last_latency_ms}ms` : "—"}
                    </span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tools" className="mt-4">
                {mcp.tools_json && Array.isArray(mcp.tools_json) && mcp.tools_json.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm mb-3">
                      <span className="text-muted-foreground">Available Tools</span>
                      <Badge variant="secondary">{mcp.tools_json.length}</Badge>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                      <TooltipProvider delayDuration={300}>
                        {mcp.tools_json.map((tool, idx) => {
                          const isExpanded = expandedTools.has(idx);
                          const hasLongDescription = tool.description && tool.description.length > 80;

                          return (
                            <div
                              key={idx}
                              className={cn(
                                "rounded-lg border bg-muted/30 p-2.5 cursor-pointer transition-all hover:bg-muted/50",
                                isExpanded && "bg-muted/50"
                              )}
                              onClick={() => {
                                const newExpanded = new Set(expandedTools);
                                if (isExpanded) {
                                  newExpanded.delete(idx);
                                } else {
                                  newExpanded.add(idx);
                                }
                                setExpandedTools(newExpanded);
                              }}
                            >
                              <div className="flex items-start gap-2">
                                <Wrench className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between">
                                    <p className="font-medium text-sm truncate" title={tool.name}>
                                      {tool.name}
                                    </p>
                                    {hasLongDescription && (
                                      <ChevronDown
                                        className={cn(
                                          "h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0 ml-1",
                                          isExpanded && "rotate-180"
                                        )}
                                      />
                                    )}
                                  </div>
                                  {tool.description && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className={cn(
                                          "text-xs text-muted-foreground mt-0.5",
                                          !isExpanded && "line-clamp-2"
                                        )}>
                                          {tool.description}
                                        </p>
                                      </TooltipTrigger>
                                      {hasLongDescription && !isExpanded && (
                                        <TooltipContent
                                          side="top"
                                          className="max-w-[300px] text-xs"
                                          sideOffset={5}
                                        >
                                          {tool.description}
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </TooltipProvider>
                    </div>
                  </div>
                ) : mcp.tools_count != null && mcp.tools_count > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Available Tools</span>
                      <Badge variant="secondary">{mcp.tools_count}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This MCP exposes {mcp.tools_count} tool{mcp.tools_count !== 1 ? "s" : ""} for AI agents to use.
                    </p>
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground italic">
                        Run a test to discover tool details.
                      </p>
                    </div>
                  </div>
                ) : runHealthCheck.isPending ? (
                  <div className="text-center py-4">
                    <Loader2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2 animate-spin" />
                    <p className="text-sm text-muted-foreground">Discovering tools...</p>
                    <p className="text-xs text-muted-foreground mt-1">Running health check to discover MCP capabilities</p>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Wrench className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No tools discovered</p>
                    <p className="text-xs text-muted-foreground mt-1">Run a test to discover tools</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="resources" className="mt-4">
                {mcp.resources_json && Array.isArray(mcp.resources_json) && mcp.resources_json.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm mb-3">
                      <span className="text-muted-foreground">Available Resources</span>
                      <Badge variant="secondary">{mcp.resources_json.length}</Badge>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                      {mcp.resources_json.map((resource, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border bg-muted/30 p-2.5"
                        >
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate" title={resource.name}>
                                {resource.name}
                              </p>
                              {resource.uri && (
                                <p className="text-xs text-muted-foreground font-mono truncate" title={resource.uri}>
                                  {resource.uri}
                                </p>
                              )}
                              {resource.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {resource.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : mcp.resources_count != null && mcp.resources_count > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Available Resources</span>
                      <Badge variant="secondary">{mcp.resources_count}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This MCP provides {mcp.resources_count} resource{mcp.resources_count !== 1 ? "s" : ""} for context.
                    </p>
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground italic">
                        Run a test to discover resource details.
                      </p>
                    </div>
                  </div>
                ) : runHealthCheck.isPending ? (
                  <div className="text-center py-4">
                    <Loader2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2 animate-spin" />
                    <p className="text-sm text-muted-foreground">Discovering resources...</p>
                    <p className="text-xs text-muted-foreground mt-1">Running health check to discover MCP capabilities</p>
                  </div>
                ) : mcp.tools_json && Array.isArray(mcp.tools_json) && mcp.tools_json.length > 0 ? (
                  // Test was run (we have tools), but no resources found
                  <div className="text-center py-4">
                    <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No resources available</p>
                    <p className="text-xs text-muted-foreground mt-1">This MCP does not expose any resources</p>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No resources discovered</p>
                    <p className="text-xs text-muted-foreground mt-1">Run a test to discover resources</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Test History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Test History
          </CardTitle>
          <CardDescription>
            Recent connection test results and performance trends
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {historyLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : testHistory && testHistory.length > 0 ? (
            <>
              {/* Status Timeline */}
              <StatusTimeline history={testHistory} maxItems={20} />

              {/* Latency Chart */}
              <LatencyTrendChart history={testHistory} maxItems={20} height={140} />

              {/* History Table */}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tools</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {testHistory.map((entry) => (
                      <ExpandableHistoryRow key={entry.id} entry={entry} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <Clock className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-lg font-medium">No test history yet</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Run your first test to start tracking performance
                  </p>
                </div>
                <Button onClick={handleRunTest} disabled={runHealthCheck.isPending}>
                  {runHealthCheck.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4" />
                      Run First Test
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
            <TooltipProvider>
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
            </TooltipProvider>
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
    </div>
  );
}

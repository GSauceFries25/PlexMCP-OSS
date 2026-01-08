"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useDomains,
  useCreateDomain,
  useVerifyDomain,
  useDeleteDomain,
  useToggleDomain,
  useAddons,
  useEnableAddon,
} from "@/lib/api/hooks";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import type { CustomDomain, DomainStatus, VerificationResult } from "@/lib/api/client";
import { DomainPaywall } from "./domain-paywall";

// Helper to copy to clipboard with toast
function useCopyToClipboard() {
  return (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };
}

// Copy button component
function CopyButton({ value, label }: { value: string; label: string }) {
  const copyToClipboard = useCopyToClipboard();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-muted-foreground hover:text-foreground"
      onClick={() => copyToClipboard(value, label)}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

// Helper to determine the CNAME Name field based on domain structure
function getCnameNameField(domain: string): string {
  const parts = domain.split(".");
  // If it's a subdomain (3+ parts like mcp.company.com), return the subdomain part
  // If it's a root domain (2 parts like company.com), return @
  if (parts.length > 2) {
    return parts[0]; // e.g., "mcp" from "mcp.company.com"
  }
  return "@"; // Root domain
}

// Helper to check if domain is a root domain
function isRootDomain(domain: string): boolean {
  return domain.split(".").length === 2;
}

// DNS Record Table Component
function DnsRecordTable({
  step,
  title,
  description,
  name,
  type,
  value,
  isRootDomain = false,
}: {
  step: number;
  title: string;
  description: string;
  name: string;
  type: "CNAME" | "TXT";
  value: string;
  isRootDomain?: boolean;
}) {
  // For root domains, show ALIAS as an alternative to CNAME
  const displayType = type === "CNAME" && isRootDomain ? "ALIAS" : type;
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
          {step}
        </span>
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left py-2 px-3 font-medium text-xs">Name</th>
              <th className="text-left py-2 px-3 font-medium text-xs">Type</th>
              <th className="text-left py-2 px-3 font-medium text-xs">Value</th>
              <th className="text-left py-2 px-3 font-medium text-xs">TTL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2 px-3">
                <div className="flex items-center gap-1">
                  <code className="bg-muted px-2 py-1 rounded text-xs font-mono">{name}</code>
                  <CopyButton value={name} label="Name" />
                </div>
              </td>
              <td className="py-2 px-3">
                <code className="bg-muted px-2 py-1 rounded text-xs font-mono">{displayType}</code>
                {type === "CNAME" && isRootDomain && (
                  <span className="text-[10px] text-muted-foreground ml-1">(or CNAME)</span>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-1">
                  <code className="bg-muted px-2 py-1 rounded text-xs font-mono truncate max-w-[180px]" title={value}>
                    {value}
                  </code>
                  <CopyButton value={value} label="Value" />
                </div>
              </td>
              <td className="py-2 px-3">
                <span className="text-xs text-muted-foreground">Auto</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// DNS Tips Component
function DnsTips({ domain }: { domain: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const isRoot = isRootDomain(domain);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
          <span className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Helpful Tips
          </span>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <span className="text-primary">•</span>
            <span>
              <strong>Auto-append:</strong> Some DNS providers automatically append your domain.
              If your provider shows the full domain, just enter the name part (e.g., <code className="bg-background px-1 rounded">_plexmcp-verification</code> instead of <code className="bg-background px-1 rounded">_plexmcp-verification.{domain}</code>).
            </span>
          </p>
          {isRoot && (
            <p className="flex items-start gap-2">
              <span className="text-yellow-500">•</span>
              <span>
                <strong>Root domain warning:</strong> Root domains (like <code className="bg-background px-1 rounded">{domain}</code>) may not support CNAME records.
                Consider using a subdomain like <code className="bg-background px-1 rounded">mcp.{domain}</code> instead.
              </span>
            </p>
          )}
          <p className="flex items-start gap-2">
            <span className="text-primary">•</span>
            <span>
              <strong>Propagation:</strong> DNS changes typically propagate within minutes, but can take up to 48 hours in some cases.
            </span>
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Verification Status Component - shows per-record pass/fail status
function VerificationStatus({
  result,
  isVerifying,
}: {
  result: VerificationResult | null;
  isVerifying: boolean;
}) {
  if (isVerifying) {
    return (
      <Alert className="border-blue-500/50 bg-blue-500/10">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <AlertTitle className="text-blue-600 dark:text-blue-400">
          Checking DNS Records...
        </AlertTitle>
        <AlertDescription className="text-sm">
          Verifying your CNAME and TXT records. This may take a few seconds.
        </AlertDescription>
      </Alert>
    );
  }

  if (!result) return null;

  if (result.success) {
    return (
      <Alert className="border-green-500/50 bg-green-500/10">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <AlertTitle className="text-green-600 dark:text-green-400">
          Verification Successful
        </AlertTitle>
        <AlertDescription className="text-sm">
          {result.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Verification Failed</AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2">
            {result.cname_valid ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            )}
            <span className="text-sm">
              {result.cname_valid
                ? "CNAME record configured correctly"
                : "CNAME record not found or incorrect"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {result.txt_valid ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            )}
            <span className="text-sm">
              {result.txt_valid
                ? "TXT record configured correctly"
                : "TXT record not found or incorrect"}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          DNS changes can take up to 48 hours to propagate. If you just added the records, wait a few minutes and try again.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function getStatusBadge(status: DomainStatus) {
  switch (status) {
    case "active":
      return (
        <Badge variant="default" className="bg-green-500/10 text-green-500 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    case "verified":
      return (
        <Badge variant="default" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Verified
        </Badge>
      );
    case "pending":
    case "verifying":
      return (
        <Badge variant="default" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
          <Clock className="h-3 w-3 mr-1" />
          {status === "verifying" ? "Verifying..." : "Pending Setup"}
        </Badge>
      );
    case "failed":
    case "expired":
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          {status === "failed" ? "Failed" : "Expired"}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function DomainCard({ domain }: { domain: CustomDomain }) {
  const [showDnsInstructions, setShowDnsInstructions] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  const verifyDomain = useVerifyDomain();
  const deleteDomain = useDeleteDomain();
  const toggleDomain = useToggleDomain();

  const handleToggle = async (checked: boolean) => {
    try {
      await toggleDomain.mutateAsync({ domainId: domain.id, isActive: checked });
      toast.success(checked ? "Domain enabled" : "Domain disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle domain");
    }
  };

  const handleVerify = async () => {
    setVerificationResult(null); // Clear previous result
    try {
      const response = await verifyDomain.mutateAsync(domain.id);
      setVerificationResult(response.verification_result);
      if (response.verification_result.success) {
        toast.success("Domain verified successfully!");
      } else {
        toast.error("Verification failed. See details below.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to verify domain");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDomain.mutateAsync(domain.id);
      toast.success("Domain deleted");
      setIsDeleteDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete domain");
    }
  };

  const needsVerification = domain.verification_status === "pending" || domain.verification_status === "failed";
  const cnameNameField = getCnameNameField(domain.domain);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-4 w-4 text-muted-foreground" />
              {domain.domain}
            </CardTitle>
            <CardDescription>
              Added {new Date(domain.created_at).toLocaleDateString()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(domain.verification_status)}
            {/* Only show toggle for verified/active domains */}
            {(domain.verification_status === "verified" || domain.verification_status === "active") && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={domain.is_active}
                  onCheckedChange={handleToggle}
                  disabled={toggleDomain.isPending}
                  aria-label="Toggle domain active state"
                />
                <Label className="text-sm text-muted-foreground">
                  {domain.is_active ? "Enabled" : "Disabled"}
                </Label>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {needsVerification && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>DNS Configuration Required</AlertTitle>
            <AlertDescription>
              Add these DNS records to your DNS provider to verify domain ownership.
            </AlertDescription>
          </Alert>
        )}

        {(showDnsInstructions || needsVerification) && (
          <div className="space-y-4">
            {/* Root domain warning */}
            {isRootDomain(domain.domain) && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertTitle className="text-yellow-600 dark:text-yellow-400">Root Domain Detected</AlertTitle>
                <AlertDescription className="text-sm">
                  <strong>{domain.domain}</strong> is a root/apex domain. Most DNS providers (including Vercel, Cloudflare)
                  don&apos;t support CNAME records on root domains. Use an <strong>ALIAS</strong> or <strong>ANAME</strong> record
                  type instead, or consider using a subdomain like <code className="bg-background px-1 rounded whitespace-nowrap">mcp.{domain.domain}</code>
                </AlertDescription>
              </Alert>
            )}

            {/* CNAME/ALIAS Record */}
            <DnsRecordTable
              step={1}
              title={isRootDomain(domain.domain) ? "ALIAS Record" : "CNAME Record"}
              description="Routes traffic from your domain to PlexMCP servers"
              name={cnameNameField}
              type="CNAME"
              value={domain.cname_target}
              isRootDomain={isRootDomain(domain.domain)}
            />

            {/* TXT Record */}
            <DnsRecordTable
              step={2}
              title="TXT Record"
              description="Verifies that you own this domain"
              name="_plexmcp-verification"
              type="TXT"
              value={`plexmcp-verify=${domain.verification_token}`}
            />

            {/* Tips Section */}
            <DnsTips domain={domain.domain} />
          </div>
        )}

        {/* Verification Status - shows after clicking Verify Now */}
        <VerificationStatus
          result={verificationResult}
          isVerifying={verifyDomain.isPending}
        />

        {domain.verification_status === "active" && domain.ssl_provisioned_at && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            SSL certificate active since {new Date(domain.ssl_provisioned_at).toLocaleDateString()}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="flex gap-2">
          {!needsVerification && domain.verification_status !== "active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDnsInstructions(!showDnsInstructions)}
            >
              {showDnsInstructions ? "Hide" : "Show"} DNS Records
            </Button>
          )}
          {needsVerification && (
            <Button
              size="sm"
              onClick={handleVerify}
              disabled={verifyDomain.isPending}
            >
              {verifyDomain.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Verify Now
                </>
              )}
            </Button>
          )}
        </div>

        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Domain</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{domain.domain}</strong>?
                This action cannot be undone and will remove all SSL certificates.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteDomain.isPending}
              >
                {deleteDomain.isPending ? "Deleting..." : "Delete Domain"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}

export function DomainManagement() {
  const router = useRouter();
  const { currentOrganization } = useAuth();
  const organizationId = useOrganizationId();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");

  const { data: domains, isLoading, error } = useDomains();
  const createDomain = useCreateDomain();

  // Add-on status
  const { data: addonsData, isLoading: addonsLoading, error: addonsError } = useAddons(organizationId);
  const enableAddon = useEnableAddon(organizationId);

  const tier = currentOrganization?.subscription_tier ?? "free";
  const isFree = tier.toLowerCase() === "free";
  const isPaidTier = ["pro", "team"].includes(tier.toLowerCase());

  // Find custom_domain addon status
  const customDomainAddon = addonsData?.addons?.find(
    (a) => a.addon_type === "custom_domain"
  );
  const isEnabled = customDomainAddon?.enabled ?? false;
  // For Pro/Team tiers, default to available=true if data hasn't loaded
  // This ensures we show paywall instead of incorrectly showing management UI
  const isAvailable = customDomainAddon?.available_for_tier ?? isPaidTier;
  const priceCents = customDomainAddon?.price_cents ?? 1000;

  const handleEnableAddon = async () => {
    try {
      const result = await enableAddon.mutateAsync({
        addonType: "custom_domain",
      });
      if (result.type === "checkout_required") {
        window.location.href = result.checkout_url;
      } else {
        toast.success("Custom Domains enabled successfully!");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to enable Custom Domains"
      );
    }
  };

  const handleUpgrade = () => {
    // Upgrade functionality removed for self-hosted deployments
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error("Please enter a domain");
      return;
    }

    // Basic domain validation
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!domainRegex.test(newDomain.trim())) {
      toast.error("Please enter a valid domain (e.g., mcp.company.com)");
      return;
    }

    try {
      await createDomain.mutateAsync(newDomain.trim());
      toast.success("Domain added! Configure your DNS records to complete setup.");
      setNewDomain("");
      setIsAddDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add domain");
    }
  };

  if (isLoading || addonsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Free tier: Show paywall with upgrade prompt
  if (isFree) {
    return (
      <DomainPaywall
        tier={tier}
        onUpgrade={handleUpgrade}
        priceCents={priceCents}
      />
    );
  }

  // Pro/Team without add-on: Show paywall with enable button
  if (!isEnabled && isAvailable) {
    return (
      <DomainPaywall
        tier={tier}
        onEnable={handleEnableAddon}
        isLoading={enableAddon.isPending}
        priceCents={priceCents}
      />
    );
  }

  if (error || addonsError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {error
            ? `Failed to load domains. ${error instanceof Error ? error.message : "Please try again."}`
            : `Failed to load addon status. ${addonsError instanceof Error ? addonsError.message : "Please try again."}`}
        </AlertDescription>
      </Alert>
    );
  }

  // Pro/Team with add-on enabled: Show full domain management
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Custom Domains</CardTitle>
              <CardDescription>
                Use your own domain to access your MCP endpoints
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Domain
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Custom Domain</DialogTitle>
                  <DialogDescription>
                    Enter your custom domain. You&apos;ll need to configure DNS records after adding it.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="domain">Domain</Label>
                    <Input
                      id="domain"
                      placeholder="mcp.company.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddDomain();
                        }
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      We recommend using a subdomain (e.g., mcp.yourcompany.com) for best compatibility.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddDomain} disabled={createDomain.isPending}>
                    {createDomain.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      "Add Domain"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {domains && domains.length > 0 ? (
            <div className="space-y-4">
              {domains.map((domain) => (
                <DomainCard key={domain.id} domain={domain} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No custom domains configured</p>
              <p className="text-sm">Add a custom domain to use your own URL for MCP endpoints.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <ExternalLink className="h-4 w-4" />
        <AlertTitle>How Custom Domains Work</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Custom domains allow you to use your own URL (e.g., mcp.yourcompany.com)
            instead of the default PlexMCP subdomain.
          </p>
          <ol className="list-decimal list-inside text-sm space-y-1 mt-2">
            <li>Add your domain above</li>
            <li>Copy the CNAME and TXT records to your DNS provider</li>
            <li>Click &quot;Verify Now&quot; to check your DNS configuration</li>
            <li>SSL certificate will be automatically provisioned once verified</li>
          </ol>
        </AlertDescription>
      </Alert>
    </div>
  );
}

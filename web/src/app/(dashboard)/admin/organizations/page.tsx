"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, isValid } from "date-fns";
import Link from "next/link";
import {
  Search,
  RefreshCw,
  Building2,
  ArrowRight,
  Crown,
  Loader2,
  AlertCircle,
  ShieldX,
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import { useAdminOrganizations } from "@/lib/api/hooks/use-admin";
import type { Organization } from "@/types/database";

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

// Status icons
function getStatusIcon(status: string | undefined) {
  switch (status) {
    case "active":
      return <CheckCircle2 className="h-3 w-3 mr-1" />;
    case "trialing":
      return <Clock className="h-3 w-3 mr-1" />;
    case "canceled":
    case "past_due":
      return <XCircle className="h-3 w-3 mr-1" />;
    default:
      return null;
  }
}

export default function OrganizationsListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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

  // Fetch organizations
  const shouldFetch = !authLoading && isAdmin;
  const { data: orgsData, isLoading: orgsLoading, error: orgsError, refetch } = useAdminOrganizations(page, 50, shouldFetch);

  const orgs = orgsData?.items || [];

  // Filter organizations by search, tier, and status
  const filteredOrgs = orgs.filter((org) => {
    // Tier filter
    if (tierFilter !== "all" && org.subscription_tier !== tierFilter) return false;

    // Status filter
    if (statusFilter !== "all" && org.subscription_status !== statusFilter) return false;

    // Search filter
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      org.name.toLowerCase().includes(query) ||
      org.slug.toLowerCase().includes(query)
    );
  });

  const handleRefresh = () => {
    refetch();
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
  if (orgsError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load Organizations</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          {(orgsError as Error)?.message || "An error occurred while loading organizations. Please try again."}
        </p>
        <Button onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Admin
          </Button>
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Organizations
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Manage all platform organizations
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <Input
            placeholder="Search by name or slug..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="team">Team</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
            <SelectItem value="past_due">Past Due</SelectItem>
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
              {searchQuery || tierFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "No organizations registered yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Slug</TableHead>
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
                  onClick={() => router.push(`/admin/organizations/${org.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-neutral-400" />
                      <span className="font-medium">{org.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono text-neutral-600 dark:text-neutral-400">
                      {org.slug}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={TIER_COLORS[org.subscription_tier || "free"]}>
                      {org.subscription_tier === "enterprise" && <Crown className="h-3 w-3 mr-1" />}
                      {org.subscription_tier || "free"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS_COLORS[org.subscription_status || "none"]}>
                      {getStatusIcon(org.subscription_status)}
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
                Page {page} of {orgsData.total_pages} ({orgsData.total} organizations)
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
                  disabled={page === orgsData.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

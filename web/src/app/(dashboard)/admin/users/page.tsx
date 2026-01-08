"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, isValid } from "date-fns";
import Link from "next/link";
import {
  Search,
  RefreshCw,
  Users,
  ArrowRight,
  Shield,
  Crown,
  Star,
  User as UserIcon,
  Loader2,
  AlertCircle,
  ShieldX,
  ArrowLeft,
  Ban,
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
import { useAdminUsers } from "@/lib/api/hooks/use-admin";
import type { User } from "@/types/database";

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

interface ExtendedUser extends User {
  org_id: string;
  org_name?: string;
  subscription_tier?: string;
  platform_role?: string;
  is_suspended?: boolean;
}

export default function UsersListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");

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

  // Fetch users
  const shouldFetch = !authLoading && isAdmin;
  const { data: usersData, isLoading: usersLoading, error: usersError, refetch } = useAdminUsers(page, 50, shouldFetch);

  const users = usersData?.items || [];

  // Filter users by search, role, and tier
  const filteredUsers = users.filter((user) => {
    const extUser = user as ExtendedUser;

    // Role filter
    if (roleFilter !== "all" && extUser.platform_role !== roleFilter) return false;

    // Tier filter
    if (tierFilter !== "all" && extUser.subscription_tier !== tierFilter) return false;

    // Search filter
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.email.toLowerCase().includes(query) ||
      user.name?.toLowerCase().includes(query) ||
      extUser.org_name?.toLowerCase().includes(query)
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
  if (usersError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load Users</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          {(usersError as Error)?.message || "An error occurred while loading users. Please try again."}
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
            Users
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Manage all platform users
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
            placeholder="Search users by email, name, or org..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="superadmin">Superadmin</SelectItem>
          </SelectContent>
        </Select>
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
              {searchQuery || roleFilter !== "all" || tierFilter !== "all"
                ? "Try adjusting your filters"
                : "No users registered yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
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
                    onClick={() => router.push(`/admin/users/${user.id}`)}
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
                        {extUser.subscription_tier === "enterprise" && <Crown className="h-3 w-3 mr-1" />}
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
                      {extUser.is_suspended ? (
                        <Badge variant="destructive" className="text-xs">
                          <Ban className="h-3 w-3 mr-1" />
                          Suspended
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                          Active
                        </Badge>
                      )}
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
    </div>
  );
}

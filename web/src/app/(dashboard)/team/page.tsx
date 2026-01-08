"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Users, MoreHorizontal, Mail, Trash2, Shield, ShieldCheck, Crown, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import {
  useTeamMembers,
  useInviteMember,
  useRemoveMember,
  useUpdateMemberRole,
  useSubscription,
  useInvitations,
  useResendInvitation,
  useCancelInvitation,
} from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";

type Role = "owner" | "admin" | "member" | "viewer";

const roleConfig: Record<Role, { label: string; icon: typeof Shield; color: string }> = {
  owner: { label: "Owner", icon: Crown, color: "bg-yellow-500" },
  admin: { label: "Admin", icon: ShieldCheck, color: "bg-blue-500" },
  member: { label: "Member", icon: Shield, color: "bg-green-500" },
  viewer: { label: "Viewer", icon: Shield, color: "bg-gray-500" },
};

// Role hierarchy for sorting (lower = higher rank)
const roleOrder: Record<Role, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  viewer: 3,
};

// Team member limits per tier
const getTeamMemberTierLimit = (tier: string | undefined): number => {
  switch (tier?.toLowerCase()) {
    case "free":
      return 1;
    case "pro":
      return 3;
    case "team":
    case "enterprise":
      return Infinity; // Unlimited
    default:
      return 1; // Default to free tier
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

export default function TeamPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { user: currentUser, currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: members, isLoading, error } = useTeamMembers(organizationId);
  const { data: subscription } = useSubscription(organizationId);
  const { data: invitations } = useInvitations(organizationId);
  const inviteMember = useInviteMember(organizationId);
  const removeMember = useRemoveMember(organizationId);
  const updateMemberRole = useUpdateMemberRole(organizationId);
  const resendInvitation = useResendInvitation(organizationId);
  const cancelInvitation = useCancelInvitation(organizationId);

  // Calculate team member limits based on subscription tier
  const teamMemberLimit = getTeamMemberTierLimit(subscription?.tier);
  const currentMemberCount = members?.length ?? 0;
  const isAtTeamLimit = currentMemberCount >= teamMemberLimit;
  const nextTier = getNextTier(subscription?.tier);

  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [newInvite, setNewInvite] = useState({ email: "", role: "member" as Role });

  // These must be called before any early returns (React hooks rule)
  const memberList = members ?? [];

  // Get current user ID safely
  const currentUserId = currentUser?.id;

  // Sort members by role hierarchy: Owner → Admin → Member → Viewer
  const sortedMembers = useMemo(() => {
    return [...memberList].sort((a, b) => {
      const roleA = (a.role as Role) || "member";
      const roleB = (b.role as Role) || "member";
      return roleOrder[roleA] - roleOrder[roleB];
    });
  }, [memberList]);

  // Find current user's role in this organization
  const currentUserRole = useMemo(() => {
    if (!currentUserId) return "member";
    const currentMember = memberList.find((m) => m.id === currentUserId);
    return (currentMember?.role as Role) || "member";
  }, [memberList, currentUserId]);

  // Permission helpers
  const canManageMembers = currentUserRole === "owner" || currentUserRole === "admin";
  const canModifyMember = (targetRole: Role): boolean => {
    if (currentUserRole === "owner") return targetRole !== "owner";
    if (currentUserRole === "admin") return ["member", "viewer"].includes(targetRole);
    return false;
  };

  const handleInvite = async () => {
    if (!newInvite.email) {
      toast.error("Email is required");
      return;
    }

    try {
      await inviteMember.mutateAsync({
        email: newInvite.email,
        role: newInvite.role,
      });

      setNewInvite({ email: "", role: "member" });
      setIsInviteDialogOpen(false);
      toast.success("Invitation sent successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invitation");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId);
      toast.success("Team member removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleChangeRole = async (userId: string, newRole: Role) => {
    try {
      await updateMemberRole.mutateAsync({ userId, role: newRole });
      toast.success("Role updated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      await resendInvitation.mutateAsync(invitationId);
      toast.success("Invitation resent successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend invitation");
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await cancelInvitation.mutateAsync(invitationId);
      toast.success("Invitation cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel invitation");
    }
  };

  const handleRestoreAccess = async (memberId: string) => {
    try {
      // TODO: Implement unsuspend member mutation when backend endpoint is ready
      // For now, show a placeholder message
      toast.info("Restore access feature will be available after the next deployment");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore access");
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatRelativeTime = (dateString?: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use BOTH async state AND sync ref check for guaranteed detection
  if (globalSigningOut || organizationsLoading || isLoading || isSigningOut || signingOutNow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-40 mb-2" />
            <Skeleton className="h-5 w-72" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
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
              {[...Array(4)].map((_, i) => (
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
    if (!currentUser) {
      return (
        <div className="space-y-6">
          <Skeleton className="h-9 w-32 mb-2" />
          <Skeleton className="h-5 w-64" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Users className="h-16 w-16 text-muted-foreground" />
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
        <Users className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Error Loading Team</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
          <p className="text-muted-foreground">
            Manage your organization&apos;s team members and permissions
          </p>
        </div>
        {/* Invite Member Button - only shown to owners and admins */}
        {canManageMembers && (
          <Button
            onClick={() => {
              if (isAtTeamLimit && nextTier) {
                setIsUpgradeDialogOpen(true);
              } else {
                setIsInviteDialogOpen(true);
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}

        {/* Invite Member Dialog */}
        <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Send an invitation to join your organization.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={newInvite.email}
                  onChange={(e) => setNewInvite({ ...newInvite, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={newInvite.role}
                  onValueChange={(value: Role) => setNewInvite({ ...newInvite, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin - Full access</SelectItem>
                    <SelectItem value="member">Member - Read & write</SelectItem>
                    <SelectItem value="viewer">Viewer - Read only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={inviteMember.isPending}>
                {inviteMember.isPending ? "Sending..." : "Send Invitation"}
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
                  <DialogTitle className="text-xl">Team Member Limit Reached</DialogTitle>
                  <DialogDescription>
                    You&apos;ve reached the maximum of {teamMemberLimit} team member{teamMemberLimit !== 1 ? "s" : ""} on your {subscription?.tier || "Free"} plan.
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
                  Get more team members and unlock additional features:
                </p>
                <ul className="space-y-2 text-sm">
                  {subscription?.tier?.toLowerCase() === "free" && (
                    <>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>Up to 5 team members (vs 1 on Free)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>Priority support</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>Advanced analytics</span>
                      </li>
                    </>
                  )}
                  {subscription?.tier?.toLowerCase() === "pro" && (
                    <>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>Unlimited team members (vs 5 on Pro)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>Audit logs</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        <span>99.5% SLA</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Currently using {currentMemberCount} of {teamMemberLimit === Infinity ? "unlimited" : teamMemberLimit} team member{teamMemberLimit !== 1 ? "s" : ""}
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

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberList.length}</div>
            <p className="text-xs text-muted-foreground">
              In organization
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {memberList.filter((m) => m.role === "admin" || m.role === "owner").length}
            </div>
            <p className="text-xs text-muted-foreground">With full access</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invitations?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">Awaiting acceptance</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suspended</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {memberList.filter((m) => m.status === "suspended").length}
            </div>
            <p className="text-xs text-muted-foreground">
              {memberList.filter((m) => m.status === "suspended").length > 0
                ? "Read-only access"
                : "No suspended members"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Invitations Section - only shown to owners and admins */}
      {canManageMembers && invitations && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>
              Invitations awaiting acceptance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => {
                  const role = (invitation.role as Role) || "member";
                  const RoleIcon = roleConfig[role]?.icon || Shield;
                  const expiresAt = new Date(invitation.expires_at);
                  const isExpiringSoon = expiresAt.getTime() - Date.now() < 48 * 60 * 60 * 1000; // 48 hours
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {invitation.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{invitation.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RoleIcon className="h-4 w-4 text-muted-foreground" />
                          <span>{roleConfig[role]?.label || "Member"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground" suppressHydrationWarning>
                        {formatDate(invitation.created_at)}
                      </TableCell>
                      <TableCell suppressHydrationWarning>
                        <Badge variant={isExpiringSoon ? "destructive" : "secondary"}>
                          {formatDate(invitation.expires_at)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResendInvitation(invitation.id)}
                            disabled={resendInvitation.isPending}
                            title="Resend invitation"
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleCancelInvitation(invitation.id)}
                            disabled={cancelInvitation.isPending}
                            title="Cancel invitation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            All members with access to your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.map((member) => {
                const role = (member.role as Role) || "member";
                const RoleIcon = roleConfig[role]?.icon || Shield;
                const isCurrentUser = member.id === currentUserId;
                const isOwner = role === "owner";
                return (
                  <TableRow
                    key={member.id}
                    className={cn(
                      isOwner && "bg-yellow-500/5 border-l-2 border-l-yellow-500"
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={member.avatar_url ?? undefined} alt={member.name || member.email} />
                          <AvatarFallback>{getInitials(member.name || member.email)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{member.name || member.email.split("@")[0]}</span>
                            {isCurrentUser && (
                              <Badge variant="outline" className="text-xs py-0 px-1.5">You</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">{member.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <RoleIcon className={cn(
                          "h-4 w-4",
                          isOwner ? "text-yellow-500" : "text-muted-foreground"
                        )} />
                        <span className={cn(isOwner && "font-medium")}>{roleConfig[role]?.label || "Member"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.status === "suspended" ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          Suspended
                        </Badge>
                      ) : (
                        <Badge variant="default">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      Recently
                    </TableCell>
                    <TableCell suppressHydrationWarning>{formatDate(member.joined_at || member.created_at)}</TableCell>
                    <TableCell>
                      {canManageMembers && canModifyMember(role) && !isCurrentUser && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleChangeRole(member.id, "admin")}
                              disabled={role === "admin"}
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleChangeRole(member.id, "member")}
                              disabled={role === "member"}
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Make Member
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleChangeRole(member.id, "viewer")}
                              disabled={role === "viewer"}
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Make Viewer
                            </DropdownMenuItem>
                            {member.status === "suspended" && currentUserRole === "owner" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleRestoreAccess(member.id)}
                                  className="text-green-600"
                                >
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                  Restore Access
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove Member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedMembers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Users className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No team members yet</p>
                      {canManageMembers && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsInviteDialogOpen(true)}
                        >
                          Invite your first team member
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
          <CardDescription>Understanding what each role can do</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-yellow-500" />
                <span className="font-medium">Owner</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Full organization control</li>
                <li>Manage billing</li>
                <li>Delete organization</li>
                <li>All admin permissions</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                <span className="font-medium">Admin</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Manage team members</li>
                <li>Manage API keys</li>
                <li>Configure MCPs</li>
                <li>View analytics</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-green-500" />
                <span className="font-medium">Member</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Create API keys</li>
                <li>Use MCPs</li>
                <li>View analytics</li>
                <li>Cannot manage team</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-gray-500" />
                <span className="font-medium">Viewer</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>View MCPs</li>
                <li>View analytics</li>
                <li>Read-only access</li>
                <li>Cannot modify settings</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

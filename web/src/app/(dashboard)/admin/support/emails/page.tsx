"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useAuth } from "@/providers/auth-provider";
import { useAdminUsers } from "@/lib/api/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Mail, Plus, Sparkles, Trash2, User, Search } from "lucide-react";
import type { StaffEmailAssignment } from "@/types/support";

export default function StaffEmailsPage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [autoGenUserId, setAutoGenUserId] = useState("");

  // Set access token when available
  useEffect(() => {
    if (accessToken) {
      apiClient.setAccessToken(accessToken);
    }
  }, [accessToken]);

  // Fetch admin/staff users for dropdown using the proven hook
  const { data: usersData } = useAdminUsers(1, 100, !!accessToken);

  // Filter to only show admin/staff users
  const allUsers = usersData?.items || [];
  const staffUsers = allUsers.filter(
    (user: any) => user.platform_role === 'admin' || user.platform_role === 'staff' || user.platform_role === 'superadmin'
  );

  // Fetch staff email assignments
  const { data: assignments, isLoading } = useQuery({
    queryKey: ["admin", "staff-emails"],
    queryFn: async () => {
      const res = await apiClient.adminListStaffEmails();
      if (res.error) throw new Error(res.error.message);
      return res.data || [];
    },
    enabled: !!accessToken, // Only run when we have an access token
  });

  // Assign email mutation
  const assignMutation = useMutation({
    mutationFn: async (data: { user_id: string; email_address: string }) => {
      const res = await apiClient.adminAssignStaffEmail(data);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Email assigned successfully");
      queryClient.invalidateQueries({ queryKey: ["admin", "staff-emails"] });
      setNewEmail("");
      setSelectedUserId("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to assign email");
    },
  });

  // Auto-generate email mutation
  const autoGenMutation = useMutation({
    mutationFn: async (user_id: string) => {
      const res = await apiClient.adminAutoGenerateStaffEmail({ user_id });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Generated email: ${data?.email_address}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "staff-emails"] });
      setAutoGenUserId("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to generate email");
    },
  });

  // Remove assignment mutation
  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await apiClient.adminRemoveStaffEmail(assignmentId);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Email assignment removed");
      queryClient.invalidateQueries({ queryKey: ["admin", "staff-emails"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove assignment");
    },
  });

  const handleAssign = () => {
    if (!selectedUserId || !newEmail) {
      toast.error("Please enter both user ID and email address");
      return;
    }
    if (!newEmail.endsWith("@plexmcp.com")) {
      toast.error("Email must be a @plexmcp.com address");
      return;
    }
    assignMutation.mutate({ user_id: selectedUserId, email_address: newEmail });
  };

  const handleAutoGenerate = () => {
    if (!autoGenUserId) {
      toast.error("Please enter a user ID");
      return;
    }
    autoGenMutation.mutate(autoGenUserId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Staff Email Assignments</h1>
        <p className="text-neutral-500 mt-2">
          Manage email addresses for staff members to receive support tickets
        </p>
      </div>

      {/* Assign Email Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Assign Email to Staff
          </CardTitle>
          <CardDescription>
            Manually assign a @plexmcp.com email address to a staff member
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="staff-select">Select Staff Member</Label>
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                disabled={assignMutation.isPending}
              >
                <SelectTrigger id="staff-select">
                  <SelectValue placeholder="Choose a staff member..." />
                </SelectTrigger>
                <SelectContent>
                  {staffUsers.length === 0 ? (
                    <SelectItem value="no-users" disabled>
                      No admin/staff users found
                    </SelectItem>
                  ) : (
                    staffUsers.map((user: any) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.email} ({user.platform_role})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-neutral-500">
                Or manually enter UUID below
              </p>
              <Input
                id="user-id-manual"
                placeholder="Or enter user UUID manually"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={assignMutation.isPending}
                className="mt-2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-email">Email Address</Label>
              <Input
                id="assign-email"
                type="email"
                placeholder="support@plexmcp.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={assignMutation.isPending}
              />
            </div>
          </div>
          <Button onClick={handleAssign} disabled={assignMutation.isPending} className="w-full md:w-auto">
            {assignMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Assign Email
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Auto-Generate Email Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Auto-Generate Email
          </CardTitle>
          <CardDescription>
            Automatically generate firstname.lastname@plexmcp.com from user's name
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auto-gen-staff-select">Select Staff Member</Label>
            <Select
              value={autoGenUserId}
              onValueChange={setAutoGenUserId}
              disabled={autoGenMutation.isPending}
            >
              <SelectTrigger id="auto-gen-staff-select">
                <SelectValue placeholder="Choose a staff member..." />
              </SelectTrigger>
              <SelectContent>
                {staffUsers.length === 0 ? (
                  <SelectItem value="no-users" disabled>
                    No admin/staff users found
                  </SelectItem>
                ) : (
                  staffUsers.map((user: any) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.email} ({user.platform_role})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-neutral-500">
              Or manually enter UUID below
            </p>
            <Input
              id="auto-gen-user-id-manual"
              placeholder="Or enter user UUID manually"
              value={autoGenUserId}
              onChange={(e) => setAutoGenUserId(e.target.value)}
              disabled={autoGenMutation.isPending}
              className="mt-2"
            />
          </div>
          <Button onClick={handleAutoGenerate} disabled={autoGenMutation.isPending} variant="secondary" className="w-full md:w-auto">
            {autoGenMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Auto-Generate
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Assignments List */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Current Assignments</h2>
        <div className="grid gap-4">
          {assignments && assignments.length > 0 ? (
            assignments.map((assignment) => (
              <Card key={assignment.id}>
                <CardContent className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="h-10 w-10 rounded-full bg-neutral-100 flex items-center justify-center">
                      <User className="h-5 w-5 text-neutral-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{assignment.email_address}</p>
                        {assignment.auto_generated && (
                          <Badge variant="outline" className="text-xs">
                            Auto-generated
                          </Badge>
                        )}
                        <Badge
                          variant={assignment.is_active ? "default" : "secondary"}
                          className={assignment.is_active ? "text-xs bg-green-500 hover:bg-green-600" : "text-xs"}
                        >
                          {assignment.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="text-sm text-neutral-500">{assignment.user_name}</p>
                      <p className="text-xs text-neutral-400">{assignment.user_email}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMutation.mutate(assignment.id)}
                    disabled={removeMutation.isPending}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Mail className="h-12 w-12 text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 mb-2">No email assignments yet</h3>
                <p className="text-sm text-neutral-500">
                  Assign email addresses to staff members to start receiving support tickets
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

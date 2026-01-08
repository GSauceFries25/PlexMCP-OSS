"use client";

import { useState } from "react";
import {
  Download,
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileJson,
  Calendar,
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useGdprExport,
  useGdprDeletionStatus,
  useRequestDeletion,
  useCancelDeletion,
} from "@/lib/api/hooks";
import { useAuth } from "@/providers/auth-provider";

// Format date for display
function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Privacy management component for GDPR compliance
 * Provides data export and account deletion functionality
 */
export function PrivacyCard() {
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  // GDPR hooks
  const { refetch: fetchExport } = useGdprExport();
  const { data: deletionStatus, isLoading: isLoadingStatus } = useGdprDeletionStatus();
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();

  // Handle data export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await fetchExport();
      if (result.data) {
        // Create and download JSON file
        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `plexmcp-data-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("Your data has been exported successfully");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export data");
    } finally {
      setIsExporting(false);
    }
  };

  // Handle deletion request
  const handleRequestDeletion = async () => {
    if (!confirmEmail) {
      toast.error("Please enter your email to confirm");
      return;
    }

    if (confirmEmail.toLowerCase() !== user?.email?.toLowerCase()) {
      toast.error("Email does not match your account email");
      return;
    }

    try {
      await requestDeletion.mutateAsync({
        confirmEmail,
        reason: deleteReason || undefined,
      });
      toast.success("Deletion request submitted. Your account will be deleted in 30 days.");
      setDeleteDialogOpen(false);
      setConfirmEmail("");
      setDeleteReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request deletion");
    }
  };

  // Handle cancel deletion
  const handleCancelDeletion = async () => {
    try {
      await cancelDeletion.mutateAsync();
      toast.success("Deletion request cancelled. Your account will remain active.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel deletion");
    }
  };

  if (isLoadingStatus) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-10 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasPendingDeletion = deletionStatus?.has_pending_request;

  return (
    <div className="space-y-4">
      {/* Data Export Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Data Export
          </CardTitle>
          <CardDescription>
            Download a complete copy of all your personal data stored in PlexMCP.
            This includes your profile, organization memberships, API keys (masked),
            support tickets, audit logs, and usage records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Under GDPR Article 15 (Right to Access), you have the right to obtain
            a copy of your personal data in a portable format.
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing Export...
              </>
            ) : (
              <>
                <FileJson className="mr-2 h-4 w-4" />
                Download My Data
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Account Deletion Card */}
      <Card className={hasPendingDeletion ? "border-orange-500" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Account Deletion
          </CardTitle>
          <CardDescription>
            Request permanent deletion of your account and all associated data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPendingDeletion ? (
            <Alert variant="default" className="border-orange-500 bg-orange-50 dark:bg-orange-950">
              <Clock className="h-4 w-4 text-orange-600" />
              <AlertTitle className="text-orange-700 dark:text-orange-400">
                Deletion Scheduled
              </AlertTitle>
              <AlertDescription className="text-orange-600 dark:text-orange-300">
                <p className="mb-2">
                  Your account is scheduled for permanent deletion on{" "}
                  <strong>{formatDate(deletionStatus?.scheduled_for ?? null)}</strong>.
                </p>
                <p className="text-sm">
                  Requested on: {formatDate(deletionStatus?.requested_at ?? null)}
                </p>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Under GDPR Article 17 (Right to Erasure), you can request deletion
                of all your personal data. This action has a <strong>30-day grace period</strong>{" "}
                during which you can cancel the request.
              </p>

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warning: This action cannot be undone</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                    <li>All your personal data will be permanently deleted</li>
                    <li>All organization memberships will be removed</li>
                    <li>All API keys will be revoked</li>
                    <li>All support tickets will be anonymized</li>
                    <li>You will not be able to recover your account</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
        <CardFooter>
          {hasPendingDeletion ? (
            <Button
              variant="outline"
              onClick={handleCancelDeletion}
              disabled={cancelDeletion.isPending}
            >
              {cancelDeletion.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Cancel Deletion Request
                </>
              )}
            </Button>
          ) : (
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Request Account Deletion
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Account Deletion</DialogTitle>
                  <DialogDescription>
                    This will schedule your account for permanent deletion in 30 days.
                    You can cancel this request at any time before the scheduled date.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="confirm-email">
                      Type your email address to confirm:{" "}
                      <strong>{user?.email}</strong>
                    </Label>
                    <Input
                      id="confirm-email"
                      type="email"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      placeholder="Enter your email"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="delete-reason">
                      Reason for leaving (optional)
                    </Label>
                    <Input
                      id="delete-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      placeholder="Help us understand why you're leaving"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleteDialogOpen(false);
                      setConfirmEmail("");
                      setDeleteReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleRequestDeletion}
                    disabled={
                      requestDeletion.isPending ||
                      confirmEmail.toLowerCase() !== user?.email?.toLowerCase()
                    }
                  >
                    {requestDeletion.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Requesting...
                      </>
                    ) : (
                      <>
                        <Calendar className="mr-2 h-4 w-4" />
                        Schedule Deletion
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

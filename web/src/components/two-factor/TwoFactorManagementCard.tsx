"use client";

import * as React from "react";
import { ShieldCheck, ShieldOff, AlertCircle, Check, Clock, Key } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { use2FAStatus } from "@/lib/api/hooks";
import { TwoFactorSetupDialog } from "./TwoFactorSetupDialog";
import { TwoFactorDisableDialog } from "./TwoFactorDisableDialog";
import { BackupCodesDialog } from "./BackupCodesDialog";

export function TwoFactorManagementCard() {
  const { data: status, isLoading, error, refetch } = use2FAStatus();
  const [showSetupDialog, setShowSetupDialog] = React.useState(false);
  const [showDisableDialog, setShowDisableDialog] = React.useState(false);
  const [showBackupDialog, setShowBackupDialog] = React.useState(false);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatLockedUntil = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Two-Factor Authentication
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load 2FA status</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isEnabled = status?.is_enabled ?? false;
  const isLocked = status?.is_locked ?? false;
  const backupCodesRemaining = status?.backup_codes_remaining ?? 0;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Add an extra layer of security to your account
              </CardDescription>
            </div>
            {isEnabled && (
              <Badge variant={isLocked ? "destructive" : "default"}>
                {isLocked ? "Locked" : "Active"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isEnabled ? (
            // 2FA not enabled
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
                <ShieldOff className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Protect Your Account</p>
                  <p className="text-muted-foreground mt-1">
                    Use an authenticator app like Google Authenticator or Authy
                    to generate verification codes for extra security.
                  </p>
                </div>
              </div>
              <Button onClick={() => setShowSetupDialog(true)}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Enable 2FA
              </Button>
            </div>
          ) : isLocked ? (
            // 2FA is locked due to too many failed attempts
            <div className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">Account Locked</p>
                  <p className="text-muted-foreground mt-1">
                    Too many failed attempts. Your account is locked until{" "}
                    <span className="font-medium">
                      {status?.locked_until
                        ? formatLockedUntil(status.locked_until)
                        : "soon"}
                    </span>
                    .
                  </p>
                </div>
              </div>
            </div>
          ) : (
            // 2FA is enabled and active
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Two-Factor Authentication Active
                  </p>
                  <div className="text-green-700 dark:text-green-300 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      Enabled on{" "}
                      {status?.enabled_at
                        ? formatDate(status.enabled_at)
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Backup codes status */}
              <div className={`rounded-lg p-4 flex items-start gap-3 ${
                backupCodesRemaining <= 3
                  ? "bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800"
                  : "bg-muted/50"
              }`}>
                <Key className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                  backupCodesRemaining <= 3
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`} />
                <div className="text-sm flex-1">
                  <p className={`font-medium ${
                    backupCodesRemaining <= 3
                      ? "text-amber-800 dark:text-amber-200"
                      : ""
                  }`}>
                    Backup Codes
                  </p>
                  <p className={`mt-1 ${
                    backupCodesRemaining <= 3
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-muted-foreground"
                  }`}>
                    {backupCodesRemaining === 0 ? (
                      "No backup codes remaining. Generate new codes now."
                    ) : backupCodesRemaining <= 3 ? (
                      `Only ${backupCodesRemaining} backup code${backupCodesRemaining !== 1 ? "s" : ""} remaining.`
                    ) : (
                      `${backupCodesRemaining} backup codes remaining.`
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBackupDialog(true)}
                >
                  {backupCodesRemaining <= 3 ? "Regenerate" : "View"}
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowBackupDialog(true)}
                >
                  <Key className="mr-2 h-4 w-4" />
                  Regenerate Backup Codes
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setShowDisableDialog(true)}
                >
                  Disable 2FA
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <TwoFactorSetupDialog
        open={showSetupDialog}
        onOpenChange={setShowSetupDialog}
        onComplete={() => refetch()}
      />
      <TwoFactorDisableDialog
        open={showDisableDialog}
        onOpenChange={setShowDisableDialog}
        onComplete={() => refetch()}
      />
      <BackupCodesDialog
        open={showBackupDialog}
        onOpenChange={setShowBackupDialog}
        remainingCodes={backupCodesRemaining}
      />
    </>
  );
}

"use client";

import * as React from "react";
import { Lock, Key, AlertCircle, Check, Clock, Plus } from "lucide-react";
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
import { usePinStatus } from "@/lib/api/hooks";
import { SetPinDialog } from "./SetPinDialog";
import { ChangePinDialog } from "./ChangePinDialog";
import { ForgotPinDialog } from "./ForgotPinDialog";

export function PinManagementCard() {
  const { data: pinStatus, isLoading, error } = usePinStatus();
  const [showSetPinDialog, setShowSetPinDialog] = React.useState(false);
  const [showChangePinDialog, setShowChangePinDialog] = React.useState(false);
  const [showForgotPinDialog, setShowForgotPinDialog] = React.useState(false);

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
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
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
            <Lock className="h-5 w-5" />
            PIN Protection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load PIN status</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasPin = pinStatus?.has_pin ?? false;
  const isLocked = pinStatus?.is_locked ?? false;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                PIN Protection
              </CardTitle>
              <CardDescription>
                Secure your API keys with a 4-digit PIN
              </CardDescription>
            </div>
            {hasPin && (
              <Badge variant={isLocked ? "destructive" : "default"}>
                {isLocked ? "Locked" : "Active"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasPin ? (
            // No PIN set
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
                <Key className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Enable PIN Protection</p>
                  <p className="text-muted-foreground mt-1">
                    Set a PIN to encrypt your API keys. You&apos;ll need this PIN to reveal
                    your keys after creation.
                  </p>
                </div>
              </div>
              <Button onClick={() => setShowSetPinDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Set PIN
              </Button>
            </div>
          ) : isLocked ? (
            // PIN is locked
            <div className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">PIN Locked</p>
                  <p className="text-muted-foreground mt-1">
                    Too many failed attempts. Your PIN is locked until{" "}
                    <span className="font-medium">
                      {pinStatus?.locked_until
                        ? formatLockedUntil(pinStatus.locked_until)
                        : "soon"}
                    </span>
                    .
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowForgotPinDialog(true)}
              >
                Forgot PIN?
              </Button>
            </div>
          ) : (
            // PIN is set and active
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-800 dark:text-green-200">
                    PIN Protection Active
                  </p>
                  <div className="text-green-700 dark:text-green-300 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      PIN set on{" "}
                      {pinStatus?.pin_set_at
                        ? formatDate(pinStatus.pin_set_at)
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowChangePinDialog(true)}
                >
                  Change PIN
                </Button>
                <Button
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setShowForgotPinDialog(true)}
                >
                  Forgot PIN?
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <SetPinDialog
        open={showSetPinDialog}
        onOpenChange={setShowSetPinDialog}
      />
      <ChangePinDialog
        open={showChangePinDialog}
        onOpenChange={setShowChangePinDialog}
      />
      <ForgotPinDialog
        open={showForgotPinDialog}
        onOpenChange={setShowForgotPinDialog}
      />
    </>
  );
}

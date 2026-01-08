"use client";

import * as React from "react";
import { Key, AlertCircle, Clock, Eye, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PinInput } from "./PinInput";
import { useRevealApiKey, usePinStatus } from "@/lib/api/hooks";

interface VerifyPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyId: string;
  keyName: string;
  onReveal: (apiKey: string) => void;
  onNeedsRegeneration?: () => void; // Called when key was created before PIN
}

export function VerifyPinDialog({
  open,
  onOpenChange,
  keyId,
  keyName,
  onReveal,
  onNeedsRegeneration,
}: VerifyPinDialogProps) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");
  const [needsRegeneration, setNeedsRegeneration] = React.useState(false);

  const revealKey = useRevealApiKey();
  // Only fetch PIN status when dialog is open to avoid API calls before auth
  const { data: pinStatus, refetch: refetchPinStatus } = usePinStatus({ enabled: open });

  const isLocked = pinStatus?.is_locked ?? false;
  const failedAttempts = pinStatus?.failed_attempts ?? 0;
  const remainingAttempts = 5 - failedAttempts;

  const resetState = () => {
    setPin("");
    setError("");
    setNeedsRegeneration(false);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handlePinChange = (value: string) => {
    setPin(value);
    setError("");
  };

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      setError("Please enter your 4-digit PIN");
      return;
    }

    try {
      const result = await revealKey.mutateAsync({ keyId, pin });
      await refetchPinStatus();
      onReveal(result.key);
      handleClose();
    } catch (err) {
      await refetchPinStatus();
      setPin("");

      const errorMessage = err instanceof Error ? err.message : "Invalid PIN";

      // Check if this is a "key created before PIN" error
      if (errorMessage.toLowerCase().includes("created before pin") ||
          errorMessage.toLowerCase().includes("not available for reveal")) {
        setNeedsRegeneration(true);
        setError(""); // Clear generic error - we'll show special UI
      } else {
        setError(errorMessage);
      }
    }
  };

  // Auto-submit when PIN is complete
  React.useEffect(() => {
    if (pin.length === 4 && !revealKey.isPending && !isLocked) {
      handleSubmit();
    }
  }, [pin]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Enter PIN to Reveal Key
          </DialogTitle>
          <DialogDescription>
            Enter your PIN to reveal the API key for <strong>{keyName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {isLocked ? (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
              <Clock className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Account Locked</p>
                <p className="text-muted-foreground mt-1">
                  Too many failed PIN attempts. Please wait 15 minutes before trying again.
                </p>
              </div>
            </div>
          ) : needsRegeneration ? (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex flex-col items-center gap-3">
              <RefreshCw className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              <div className="text-center">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Key Created Before PIN Was Set
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                  This API key was created before you set your PIN, so it cannot be revealed.
                  You&apos;ll need to regenerate it to create a PIN-protected version.
                </p>
              </div>
            </div>
          ) : (
            <>
              <PinInput
                value={pin}
                onChange={handlePinChange}
                autoFocus
                error={!!error}
                disabled={revealKey.isPending}
              />

              {/* Error Message */}
              {error && (
                <div className="flex items-center justify-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}

              {/* Attempts Warning */}
              {failedAttempts > 0 && failedAttempts < 5 && (
                <div className="text-center text-sm text-amber-600 dark:text-amber-400">
                  {remainingAttempts} attempt{remainingAttempts !== 1 ? "s" : ""} remaining before lockout
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {needsRegeneration && onNeedsRegeneration ? (
            <Button
              onClick={() => {
                onNeedsRegeneration();
                handleClose();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate Key
            </Button>
          ) : !isLocked && !needsRegeneration && (
            <Button
              onClick={handleSubmit}
              disabled={pin.length !== 4 || revealKey.isPending}
            >
              {revealKey.isPending ? (
                "Verifying..."
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Reveal Key
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

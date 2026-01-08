"use client";

import * as React from "react";
import { ShieldOff, Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useDisable2FA } from "@/lib/api/hooks";
import { TwoFactorCodeInput } from "./TwoFactorCodeInput";

interface TwoFactorDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function TwoFactorDisableDialog({
  open,
  onOpenChange,
  onComplete,
}: TwoFactorDisableDialogProps) {
  const [code, setCode] = React.useState("");
  const disable2FA = useDisable2FA();

  React.useEffect(() => {
    if (open) {
      setCode("");
    }
  }, [open]);

  const handleDisable = async () => {
    try {
      await disable2FA.mutateAsync({ code });
      toast.success("Two-factor authentication disabled", {
        description: "Your account is now protected by password only.",
      });
      onComplete?.();
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to disable 2FA", {
        description: error instanceof Error ? error.message : "Invalid code. Please try again.",
      });
    }
  };

  // Check if it's a valid 6-digit code or backup code (XXXX-XXXX or 8 digits)
  const isValidCode = /^\d{6}$/.test(code) || /^\d{4}-\d{4}$/.test(code) || /^\d{8}$/.test(code);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-5 w-5" />
            Disable Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            Enter your authentication code to disable 2FA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Warning</p>
              <p className="text-muted-foreground mt-1">
                Disabling 2FA will make your account less secure.
                You will only need your password to log in.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Verification Code</Label>
            <TwoFactorCodeInput
              value={code}
              onChange={setCode}
              autoFocus
              error={disable2FA.isError}
            />
            <p className="text-xs text-muted-foreground">
              Enter your authenticator code or a backup code
            </p>
            {disable2FA.isError && (
              <p className="text-sm text-destructive">
                Invalid code. Please try again.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDisable}
            disabled={!isValidCode || disable2FA.isPending}
          >
            {disable2FA.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disabling...
              </>
            ) : (
              "Disable 2FA"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

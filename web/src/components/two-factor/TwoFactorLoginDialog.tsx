"use client";

import * as React from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TwoFactorCodeInput } from "./TwoFactorCodeInput";

interface TwoFactorLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (code: string, rememberDevice: boolean) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

export function TwoFactorLoginDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  error = null,
}: TwoFactorLoginDialogProps) {
  const [code, setCode] = React.useState("");
  const [rememberDevice, setRememberDevice] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCode("");
      // Don't reset rememberDevice - keep user preference
    }
  }, [open]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting) return;
    await onSubmit(code, rememberDevice);
  };

  // Auto-submit when 6 digits are entered
  const handleCodeComplete = (completedCode: string) => {
    if (!isSubmitting) {
      onSubmit(completedCode, rememberDevice);
    }
  };

  // Check if it's a valid 6-digit code or backup code
  // Supports: 6-digit TOTP, XXXX-XXXX (legacy), xxxxx-xxxxx (new alphanumeric)
  const isValidCode =
    /^\d{6}$/.test(code) || // TOTP code
    /^\d{4}-\d{4}$/.test(code) || // Legacy numeric backup code
    /^\d{8}$/.test(code) || // Legacy backup code without hyphen
    /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(code) || // New alphanumeric backup code
    /^[a-z0-9]{10}$/i.test(code); // New backup code without hyphen

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Two-Factor Authentication
            </DialogTitle>
            <DialogDescription>
              Enter the verification code from your authenticator app to continue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="2fa-code">Verification Code</Label>
              <TwoFactorCodeInput
                value={code}
                onChange={setCode}
                onComplete={handleCodeComplete}
                autoFocus
                disabled={isSubmitting}
                error={!!error}
              />
              <p className="text-xs text-muted-foreground">
                Enter your 6-digit code or a backup code
              </p>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember-device"
                checked={rememberDevice}
                onCheckedChange={(checked) => setRememberDevice(checked === true)}
                disabled={isSubmitting}
              />
              <Label
                htmlFor="remember-device"
                className="text-sm font-normal cursor-pointer"
              >
                Remember this device for 30 days
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValidCode || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { Copy, Check, Key, Loader2, RefreshCw } from "lucide-react";
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
import { useRegenerateBackupCodes } from "@/lib/api/hooks";
import { TwoFactorCodeInput } from "./TwoFactorCodeInput";

interface BackupCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current number of remaining backup codes */
  remainingCodes?: number;
}

export function BackupCodesDialog({
  open,
  onOpenChange,
  remainingCodes = 0,
}: BackupCodesDialogProps) {
  const [step, setStep] = React.useState<"verify" | "codes">("verify");
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [copied, setCopied] = React.useState(false);

  const regenerate = useRegenerateBackupCodes();

  React.useEffect(() => {
    if (open) {
      setStep("verify");
      setCode("");
      setBackupCodes([]);
      setCopied(false);
    }
  }, [open]);

  const handleRegenerate = async () => {
    try {
      const result = await regenerate.mutateAsync({ code });
      setBackupCodes(result.backup_codes);
      setStep("codes");
      toast.success("New backup codes generated", {
        description: "Your old backup codes are no longer valid.",
      });
    } catch (error) {
      toast.error("Failed to regenerate codes", {
        description: error instanceof Error ? error.message : "Invalid code. Please try again.",
      });
    }
  };

  const copyBackupCodes = async () => {
    const text = backupCodes.join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Backup codes copied", {
      description: "Store these codes in a safe place.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const canRegenerate = code.length === 6 && /^\d{6}$/.test(code);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {step === "verify" ? "Regenerate Backup Codes" : "New Backup Codes"}
          </DialogTitle>
          <DialogDescription>
            {step === "verify"
              ? "Enter your authenticator code to generate new backup codes. This will invalidate your existing codes."
              : "Store these codes safely. You'll need them if you lose access to your authenticator."}
          </DialogDescription>
        </DialogHeader>

        {step === "verify" && (
          <div className="space-y-4">
            {remainingCodes <= 3 && remainingCodes > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  You only have <strong>{remainingCodes}</strong> backup code{remainingCodes !== 1 ? "s" : ""} remaining.
                </p>
              </div>
            )}

            {remainingCodes === 0 && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm text-destructive">
                  You have no backup codes remaining. Generate new codes now.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Authenticator Code</Label>
              <TwoFactorCodeInput
                value={code}
                onChange={setCode}
                autoFocus
                error={regenerate.isError}
              />
              <p className="text-xs text-muted-foreground">
                You must use your authenticator app code (not a backup code)
              </p>
              {regenerate.isError && (
                <p className="text-sm text-destructive">
                  Invalid code. Please try again.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRegenerate}
                disabled={!canRegenerate || regenerate.isPending}
              >
                {regenerate.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Generate New Codes
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "codes" && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Each code can only be used once. Your old codes are no longer valid.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
              {backupCodes.map((code, i) => (
                <div key={i} className="text-center py-1">
                  {code}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={copyBackupCodes}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Codes
                  </>
                )}
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

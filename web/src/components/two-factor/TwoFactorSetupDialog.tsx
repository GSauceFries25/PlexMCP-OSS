"use client";

import * as React from "react";
import { Copy, Check, ShieldCheck, Loader2, AlertCircle, QrCode } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useBegin2FASetup, useConfirm2FASetup } from "@/lib/api/hooks";
import { TwoFactorCodeInput } from "./TwoFactorCodeInput";

interface TwoFactorSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type SetupStep = "qr" | "verify" | "backup";

export function TwoFactorSetupDialog({
  open,
  onOpenChange,
  onComplete,
}: TwoFactorSetupDialogProps) {
  const [step, setStep] = React.useState<SetupStep>("qr");
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [copied, setCopied] = React.useState(false);
  const [secretCopied, setSecretCopied] = React.useState(false);

  const beginSetup = useBegin2FASetup();
  const confirmSetup = useConfirm2FASetup();

  // Start setup when dialog opens
  React.useEffect(() => {
    if (open) {
      beginSetup.mutate();
      setStep("qr");
      setCode("");
      setBackupCodes([]);
      setCopied(false);
      setSecretCopied(false);
    }
  }, [open]);

  const handleVerify = async (codeOverride?: string) => {
    if (!beginSetup.data) return;
    const codeToSubmit = codeOverride || code;

    try {
      const result = await confirmSetup.mutateAsync({
        setup_token: beginSetup.data.setup_token,
        code: codeToSubmit,
      });
      setBackupCodes(result.backup_codes);
      setStep("backup");
    } catch (error) {
      toast.error("Verification failed", {
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

  const copySecret = async () => {
    if (!beginSetup.data?.secret) return;
    await navigator.clipboard.writeText(beginSetup.data.secret);
    setSecretCopied(true);
    toast.success("Secret key copied", {
      description: "You can enter this manually in your authenticator app.",
    });
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const handleClose = () => {
    if (step === "backup") {
      onComplete?.();
    }
    onOpenChange(false);
  };

  const canVerify = code.length === 6 && /^\d{6}$/.test(code);

  // Auto-submit when 6 digits are entered
  const handleCodeComplete = (completedCode: string) => {
    if (!confirmSetup.isPending) {
      handleVerify(completedCode);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {step === "qr" && "Set Up Two-Factor Authentication"}
            {step === "verify" && "Verify Your Code"}
            {step === "backup" && "Save Your Backup Codes"}
          </DialogTitle>
          <DialogDescription>
            {step === "qr" && "Scan the QR code with your authenticator app."}
            {step === "verify" && "Enter the 6-digit code from your authenticator app."}
            {step === "backup" && "Store these codes safely. You'll need them if you lose access to your authenticator."}
          </DialogDescription>
        </DialogHeader>

        {step === "qr" && (
          <div className="space-y-4">
            {beginSetup.isPending ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : beginSetup.error ? (
              <div className="flex items-center gap-2 text-destructive p-4 bg-destructive/10 rounded-lg">
                <AlertCircle className="h-5 w-5" />
                <span>Failed to start setup. Please try again.</span>
              </div>
            ) : beginSetup.data ? (
              <>
                {/* QR Code */}
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <img
                    src={beginSetup.data.qr_code}
                    alt="QR Code for authenticator app"
                    className="w-48 h-48"
                  />
                </div>

                {/* Manual entry option */}
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    Or enter this key manually:
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={beginSetup.data.secret}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={copySecret}
                    >
                      {secretCopied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setStep("verify")}>
                    Continue
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Verification Code</Label>
              <TwoFactorCodeInput
                value={code}
                onChange={setCode}
                onComplete={handleCodeComplete}
                autoFocus
                disabled={confirmSetup.isPending}
                error={confirmSetup.isError}
              />
              {confirmSetup.isError && (
                <p className="text-sm text-destructive">
                  Invalid code. Please check your authenticator app and try again.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("qr")}>
                Back
              </Button>
              <Button
                onClick={() => handleVerify()}
                disabled={!canVerify || confirmSetup.isPending}
              >
                {confirmSetup.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Enable"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "backup" && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Each code can only be used once. Save these in a secure location.
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
              <Button onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

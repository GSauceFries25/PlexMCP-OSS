"use client";

import * as React from "react";
import { Lock, Shield, AlertCircle, Check } from "lucide-react";
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
import { useSetPin, usePinStatus } from "@/lib/api/hooks";
import { toast } from "sonner";

interface SetPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetPinDialog({ open, onOpenChange, onSuccess }: SetPinDialogProps) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [error, setError] = React.useState("");

  const setPin$ = useSetPin();
  // Only fetch PIN status when dialog is open to avoid API calls before auth
  const { refetch: refetchPinStatus } = usePinStatus({ enabled: open });

  const resetState = () => {
    setStep(1);
    setPin("");
    setConfirmPin("");
    setError("");
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handlePinChange = (value: string) => {
    setPin(value);
    setError("");
  };

  const handleConfirmPinChange = (value: string) => {
    setConfirmPin(value);
    setError("");
  };

  const handleNextStep = () => {
    if (pin.length !== 4) {
      setError("Please enter a 4-digit PIN");
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (confirmPin.length !== 4) {
      setError("Please confirm your 4-digit PIN");
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match");
      setConfirmPin("");
      return;
    }

    try {
      await setPin$.mutateAsync({ pin });
      await refetchPinStatus();
      toast.success("PIN set successfully! Your API keys are now protected.");
      handleClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {step === 1 ? "Set Your PIN" : "Confirm Your PIN"}
          </DialogTitle>
          <DialogDescription>
            {step === 1 ? (
              "Create a 4-digit PIN to protect your API keys. You'll need this PIN to reveal your keys."
            ) : (
              "Enter your PIN again to confirm."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* Security Info Banner */}
          {step === 1 && (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
              <Lock className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium">Why set a PIN?</p>
                <ul className="mt-1 space-y-1 text-xs">
                  <li>- Your API keys will be encrypted with your PIN</li>
                  <li>- Only you can reveal your keys</li>
                  <li>- 5 wrong attempts will lock you out for 15 minutes</li>
                </ul>
              </div>
            </div>
          )}

          {/* PIN Input */}
          <div className="space-y-4">
            <PinInput
              value={step === 1 ? pin : confirmPin}
              onChange={step === 1 ? handlePinChange : handleConfirmPinChange}
              autoFocus
              error={!!error}
            />

            {/* Error Message */}
            {error && (
              <div className="flex items-center justify-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            {/* Step indicator */}
            <div className="flex justify-center gap-2">
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  step === 1 ? "bg-primary" : "bg-muted"
                }`}
              />
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  step === 2 ? "bg-primary" : "bg-muted"
                }`}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleNextStep} disabled={pin.length !== 4}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={confirmPin.length !== 4 || setPin$.isPending}
              >
                {setPin$.isPending ? (
                  "Setting PIN..."
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Confirm PIN
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

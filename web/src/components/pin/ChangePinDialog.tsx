"use client";

import * as React from "react";
import { Key, AlertCircle, Check } from "lucide-react";
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
import { useChangePin, usePinStatus } from "@/lib/api/hooks";
import { toast } from "sonner";

interface ChangePinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ChangePinDialog({ open, onOpenChange, onSuccess }: ChangePinDialogProps) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [currentPin, setCurrentPin] = React.useState("");
  const [newPin, setNewPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [error, setError] = React.useState("");

  const changePin$ = useChangePin();
  const { refetch: refetchPinStatus } = usePinStatus({ enabled: open });

  const resetState = () => {
    setStep(1);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setError("");
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleCurrentPinChange = (value: string) => {
    setCurrentPin(value);
    setError("");
  };

  const handleNewPinChange = (value: string) => {
    setNewPin(value);
    setError("");
  };

  const handleConfirmPinChange = (value: string) => {
    setConfirmPin(value);
    setError("");
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (currentPin.length !== 4) {
        setError("Please enter your current 4-digit PIN");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (newPin.length !== 4) {
        setError("Please enter a new 4-digit PIN");
        return;
      }
      if (newPin === currentPin) {
        setError("New PIN must be different from current PIN");
        return;
      }
      setStep(3);
    }
  };

  const handleSubmit = async () => {
    if (confirmPin.length !== 4) {
      setError("Please confirm your new 4-digit PIN");
      return;
    }

    if (newPin !== confirmPin) {
      setError("PINs do not match");
      setConfirmPin("");
      return;
    }

    try {
      await changePin$.mutateAsync({ current_pin: currentPin, new_pin: newPin });
      await refetchPinStatus();
      toast.success("PIN changed successfully!");
      handleClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change PIN");
      // If current PIN is wrong, go back to step 1
      if (err instanceof Error && err.message.toLowerCase().includes("invalid")) {
        setStep(1);
        setCurrentPin("");
      }
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 1: return "Enter Current PIN";
      case 2: return "Enter New PIN";
      case 3: return "Confirm New PIN";
    }
  };

  const getStepDescription = () => {
    switch (step) {
      case 1: return "Enter your current PIN to verify your identity.";
      case 2: return "Choose a new 4-digit PIN.";
      case 3: return "Enter your new PIN again to confirm.";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            {getStepTitle()}
          </DialogTitle>
          <DialogDescription>
            {getStepDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* PIN Input */}
          <div className="space-y-4">
            <PinInput
              value={step === 1 ? currentPin : step === 2 ? newPin : confirmPin}
              onChange={step === 1 ? handleCurrentPinChange : step === 2 ? handleNewPinChange : handleConfirmPinChange}
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
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    step === s ? "bg-primary" : s < step ? "bg-primary/50" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleNextStep} disabled={currentPin.length !== 4}>
                Next
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={handleNextStep} disabled={newPin.length !== 4}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={confirmPin.length !== 4 || changePin$.isPending}
              >
                {changePin$.isPending ? (
                  "Changing PIN..."
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Change PIN
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

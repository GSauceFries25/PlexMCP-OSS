"use client";

import * as React from "react";
import { Key, Lock, ShieldCheck } from "lucide-react";
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

interface EncryptWithPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (pin: string) => void;
  actionType: "create" | "rotate";
  keyName?: string;
  isLoading?: boolean;
}

export function EncryptWithPinDialog({
  open,
  onOpenChange,
  onSubmit,
  actionType,
  keyName,
  isLoading = false,
}: EncryptWithPinDialogProps) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");

  const resetState = () => {
    setPin("");
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

  const handleSubmit = () => {
    if (pin.length !== 4) {
      setError("Please enter your 4-digit PIN");
      return;
    }

    onSubmit(pin);
  };

  // Auto-submit when PIN is complete
  React.useEffect(() => {
    if (pin.length === 4 && !isLoading) {
      handleSubmit();
    }
  }, [pin]);

  const title = actionType === "create"
    ? "Encrypt New API Key"
    : "Encrypt Rotated Key";

  const description = actionType === "create"
    ? "Enter your PIN to encrypt the new API key so you can reveal it later."
    : `Enter your PIN to encrypt the new key for "${keyName}".`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
            <Lock className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Your PIN encrypts the key so only you can reveal it later. This keeps your API keys secure.
            </p>
          </div>

          <PinInput
            value={pin}
            onChange={handlePinChange}
            autoFocus
            error={!!error}
            disabled={isLoading}
          />

          {/* Error Message */}
          {error && (
            <div className="text-center text-destructive text-sm">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pin.length !== 4 || isLoading}
          >
            {isLoading ? (
              "Processing..."
            ) : (
              <>
                <Key className="mr-2 h-4 w-4" />
                {actionType === "create" ? "Create & Encrypt" : "Rotate & Encrypt"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

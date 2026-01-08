"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PinInput } from "@/components/pin";
import { useResetPin } from "@/lib/api/hooks";
import { toast } from "sonner";
import { ArrowLeft, AlertCircle, Check, Key, Lock, Loader2 } from "lucide-react";

function ResetPinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [step, setStep] = useState<1 | 2>(1);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [invalidatedCount, setInvalidatedCount] = useState(0);

  const resetPin$ = useResetPin();

  // Check for token on mount
  useEffect(() => {
    if (!token) {
      setError("No reset token provided. Please use the link from your email.");
    }
  }, [token]);

  const handleNewPinChange = (value: string) => {
    setNewPin(value);
    setError("");
  };

  const handleConfirmPinChange = (value: string) => {
    setConfirmPin(value);
    setError("");
  };

  const handleNextStep = () => {
    if (newPin.length !== 4) {
      setError("Please enter a 4-digit PIN");
      return;
    }
    setStep(2);
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

    if (!token) {
      setError("No reset token provided");
      return;
    }

    try {
      const result = await resetPin$.mutateAsync({ token, new_pin: newPin });
      setInvalidatedCount(result.invalidated_keys_count);
      setIsSuccess(true);
      toast.success("PIN reset successfully!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset PIN";
      setError(message);
      // If token is invalid, stay on this page with error
      if (message.toLowerCase().includes("token") || message.toLowerCase().includes("expired")) {
        setStep(1);
        setNewPin("");
        setConfirmPin("");
      }
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
            <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold">PIN Reset Complete</CardTitle>
          <CardDescription>
            Your PIN has been successfully reset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invalidatedCount > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm">
              <p className="text-amber-800 dark:text-amber-200">
                <strong>{invalidatedCount}</strong> API key(s) were invalidated and will need to be regenerated.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center">
            You can now use your new PIN to protect and reveal your API keys.
          </p>
          <Button className="w-full" onClick={() => router.push("/settings")}>
            Go to Settings
          </Button>
        </CardContent>
        <CardFooter>
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm text-primary hover:underline mx-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // Error state - no token
  if (!token) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold">Invalid Link</CardTitle>
          <CardDescription>
            This PIN reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Please request a new reset link from the Settings page.
          </p>
          <Button className="w-full" variant="outline" onClick={() => router.push("/settings")}>
            Go to Settings
          </Button>
        </CardContent>
        <CardFooter>
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm text-primary hover:underline mx-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          {step === 1 ? (
            <Key className="h-6 w-6 text-primary" />
          ) : (
            <Lock className="h-6 w-6 text-primary" />
          )}
        </div>
        <CardTitle className="text-2xl font-bold">
          {step === 1 ? "Create New PIN" : "Confirm New PIN"}
        </CardTitle>
        <CardDescription>
          {step === 1
            ? "Enter a new 4-digit PIN to protect your API keys."
            : "Enter your new PIN again to confirm."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <PinInput
          value={step === 1 ? newPin : confirmPin}
          onChange={step === 1 ? handleNewPinChange : handleConfirmPinChange}
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
              step === 1 ? "bg-primary" : "bg-primary/50"
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full transition-colors ${
              step === 2 ? "bg-primary" : "bg-muted"
            }`}
          />
        </div>

        {step === 1 ? (
          <Button
            className="w-full"
            onClick={handleNextStep}
            disabled={newPin.length !== 4}
          >
            Next
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={confirmPin.length !== 4 || resetPin$.isPending}
            >
              {resetPin$.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Reset PIN
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link
          href="/login"
          className="flex items-center gap-2 text-sm text-primary hover:underline mx-auto"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function ResetPinPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold">Loading...</CardTitle>
          </CardHeader>
        </Card>
      }
    >
      <ResetPinContent />
    </Suspense>
  );
}

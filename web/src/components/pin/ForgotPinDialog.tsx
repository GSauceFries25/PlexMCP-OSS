"use client";

import * as React from "react";
import { AlertTriangle, Mail, Send, Check } from "lucide-react";
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
import { useForgotPin } from "@/lib/api/hooks";
import { useAuth } from "@/providers/auth-provider";
import { toast } from "sonner";

interface ForgotPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForgotPinDialog({ open, onOpenChange }: ForgotPinDialogProps) {
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [emailSent, setEmailSent] = React.useState(false);
  const { user } = useAuth();
  const forgotPin$ = useForgotPin();

  const resetState = () => {
    setAcknowledged(false);
    setEmailSent(false);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!user?.email) {
      toast.error("Unable to determine your email address");
      return;
    }

    try {
      await forgotPin$.mutateAsync({ email: user.email });
      setEmailSent(true);
      toast.success("Check your email for the reset link");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset email");
    }
  };

  if (emailSent) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Check Your Email
            </DialogTitle>
          </DialogHeader>

          <div className="py-6 space-y-4">
            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
              <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Reset link sent!
                </p>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  We&apos;ve sent a PIN reset link to <strong>{user?.email}</strong>.
                  The link expires in 1 hour.
                </p>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <p>Didn&apos;t receive the email?</p>
              <ul className="mt-2 list-disc list-inside space-y-1">
                <li>Check your spam folder</li>
                <li>Make sure you entered the correct email</li>
                <li>Wait a few minutes and try again</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Reset Your PIN
          </DialogTitle>
          <DialogDescription>
            Request a PIN reset link via email.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Warning Banner */}
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-semibold">Important: This will invalidate your API keys</p>
                <p className="mt-1">
                  Resetting your PIN will permanently remove access to all encrypted API keys.
                  You will need to regenerate any keys you want to view again.
                </p>
              </div>
            </div>
          </div>

          {/* Email info */}
          <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-3">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm">
              <p className="text-muted-foreground">Reset link will be sent to:</p>
              <p className="font-medium">{user?.email || "Loading..."}</p>
            </div>
          </div>

          {/* Acknowledgment Checkbox */}
          <div className="flex items-start space-x-3 pt-2">
            <Checkbox
              id="acknowledge"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <label
              htmlFor="acknowledge"
              className="text-sm leading-relaxed cursor-pointer"
            >
              I understand that resetting my PIN will permanently invalidate all my encrypted
              API keys and I will need to regenerate them.
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!acknowledged || forgotPin$.isPending}
            variant="destructive"
          >
            {forgotPin$.isPending ? (
              "Sending..."
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Reset Link
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

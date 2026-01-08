"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TwoFactorCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  error?: boolean;
}

/**
 * A 6-digit code input for 2FA verification.
 * Supports TOTP codes (6 digits) and backup codes (8 digits with hyphen).
 */
export function TwoFactorCodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
  className,
  error = false,
}: TwoFactorCodeInputProps) {
  // Track if we've already triggered onComplete for current value
  const hasTriggeredRef = React.useRef(false);
  // Prevent auto-submit on initial mount (e.g., from browser autofill)
  const [isReady, setIsReady] = React.useState(false);

  // Wait 500ms before enabling auto-submit to prevent autofill from triggering immediately
  React.useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Reset trigger flag when value changes to something invalid
  React.useEffect(() => {
    if (!/^\d{6}$/.test(value)) {
      hasTriggeredRef.current = false;
    }
  }, [value]);

  const checkAndTriggerComplete = (newValue: string) => {
    // Auto-submit when 6 digits are entered (TOTP code)
    // Only trigger after isReady (500ms delay) to prevent autofill from auto-submitting
    if (/^\d{6}$/.test(newValue) && !hasTriggeredRef.current && !disabled && isReady) {
      hasTriggeredRef.current = true;
      // Small delay to let React update the value first
      setTimeout(() => {
        onComplete?.(newValue);
      }, 50);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;

    // Allow digits and hyphens (for backup codes in XXXX-XXXX format)
    newValue = newValue.replace(/[^\d-]/g, "");

    // Limit to 9 characters (backup code format: XXXX-XXXX)
    if (newValue.length > 9) {
      newValue = newValue.slice(0, 9);
    }

    onChange(newValue);
    checkAndTriggerComplete(newValue);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    let pastedText = e.clipboardData.getData("text");

    // Clean up pasted text - allow digits and hyphens
    pastedText = pastedText.replace(/[^\d-]/g, "").slice(0, 9);

    onChange(pastedText);
    checkAndTriggerComplete(pastedText);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[\d-]*"
      autoComplete="one-time-code"
      value={value}
      onChange={handleChange}
      onPaste={handlePaste}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder="000000"
      className={cn(
        "text-center text-2xl tracking-[0.5em] font-mono",
        error && "border-destructive focus-visible:ring-destructive",
        className
      )}
      maxLength={9}
    />
  );
}

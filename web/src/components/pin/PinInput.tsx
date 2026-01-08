"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
  className?: string;
}

export function PinInput({
  value,
  onChange,
  length = 4,
  disabled = false,
  autoFocus = false,
  error = false,
  className,
}: PinInputProps) {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  React.useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleChange = (index: number, inputValue: string) => {
    // Only allow numeric input
    const numericValue = inputValue.replace(/\D/g, "");

    if (numericValue.length === 0) {
      // Handle deletion
      const newValue = value.slice(0, index) + value.slice(index + 1);
      onChange(newValue.padEnd(value.length, "").slice(0, length));
      return;
    }

    // Handle paste of multiple digits
    if (numericValue.length > 1) {
      const pastedDigits = numericValue.slice(0, length - index);
      const newValue = value.slice(0, index) + pastedDigits + value.slice(index + pastedDigits.length);
      onChange(newValue.slice(0, length));

      // Focus the next empty input or the last input
      const nextIndex = Math.min(index + pastedDigits.length, length - 1);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    // Handle single digit input
    const newValue = value.slice(0, index) + numericValue + value.slice(index + 1);
    onChange(newValue.slice(0, length));

    // Move to next input
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!value[index] && index > 0) {
        // If current input is empty, move to previous and clear it
        inputRefs.current[index - 1]?.focus();
        const newValue = value.slice(0, index - 1) + value.slice(index);
        onChange(newValue);
      } else {
        // Clear current input
        const newValue = value.slice(0, index) + value.slice(index + 1);
        onChange(newValue);
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pastedData);

    // Focus the next empty input or the last input
    const nextIndex = Math.min(pastedData.length, length - 1);
    inputRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={cn("flex gap-2 justify-center", className)}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={value[index] || ""}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className={cn(
            "w-12 h-14 text-center text-2xl font-mono border rounded-lg",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-all duration-200",
            error
              ? "border-destructive ring-destructive/20"
              : "border-input hover:border-primary/50"
          )}
          aria-label={`PIN digit ${index + 1}`}
        />
      ))}
    </div>
  );
}

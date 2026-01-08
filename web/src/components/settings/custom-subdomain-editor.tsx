"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Pencil,
  Check,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useCheckSubdomain, useUpdateCustomSubdomain } from "@/lib/api/hooks";
import { BASE_DOMAIN } from "@/lib/mcp-url";

interface CustomSubdomainEditorProps {
  currentSubdomain: string | null | undefined;
  autoSubdomain: string | null | undefined;
  organizationId: string;
}

// Validation rules matching backend
function validateSubdomain(subdomain: string): string | null {
  if (subdomain.length < 3) {
    return "Subdomain must be at least 3 characters";
  }
  if (subdomain.length > 50) {
    return "Subdomain must be 50 characters or less";
  }
  if (!/^[a-z0-9-]+$/.test(subdomain)) {
    return "Only lowercase letters, numbers, and hyphens allowed";
  }
  if (subdomain.startsWith("-") || subdomain.endsWith("-")) {
    return "Cannot start or end with a hyphen";
  }
  if (subdomain.includes("--")) {
    return "Cannot contain consecutive hyphens";
  }
  return null;
}

export function CustomSubdomainEditor({
  currentSubdomain,
  autoSubdomain,
  organizationId,
}: CustomSubdomainEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentSubdomain ?? "");
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);
  const [debouncedValue, setDebouncedValue] = useState(inputValue);

  const checkSubdomain = useCheckSubdomain();
  const updateSubdomain = useUpdateCustomSubdomain();

  // Reset input when currentSubdomain changes
  useEffect(() => {
    setInputValue(currentSubdomain ?? "");
  }, [currentSubdomain]);

  // Debounce the input value for API checks
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(inputValue);
    }, 500);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Check availability when debounced value changes
  useEffect(() => {
    const trimmed = debouncedValue.trim().toLowerCase();

    // Skip check if empty, same as current, or has local validation errors
    if (!trimmed || trimmed === currentSubdomain || localValidationError) {
      return;
    }

    checkSubdomain.mutate(trimmed);
  }, [debouncedValue, currentSubdomain, localValidationError]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    setInputValue(value);

    // Clear API error when typing
    checkSubdomain.reset();

    // Validate locally
    if (value.trim()) {
      setLocalValidationError(validateSubdomain(value.trim()));
    } else {
      setLocalValidationError(null);
    }
  }, [checkSubdomain]);

  const handleSave = async () => {
    const trimmed = inputValue.trim().toLowerCase();

    // Final validation
    if (trimmed) {
      const validationError = validateSubdomain(trimmed);
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }

    try {
      await updateSubdomain.mutateAsync({
        organizationId,
        customSubdomain: trimmed,
      });
      toast.success(
        trimmed
          ? "Custom subdomain saved successfully!"
          : "Custom subdomain removed. Using auto-generated subdomain."
      );
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subdomain");
    }
  };

  const handleCancel = () => {
    setInputValue(currentSubdomain ?? "");
    setLocalValidationError(null);
    checkSubdomain.reset();
    setIsEditing(false);
  };

  const handleRemove = async () => {
    try {
      await updateSubdomain.mutateAsync({
        organizationId,
        customSubdomain: "",
      });
      toast.success("Custom subdomain removed. Using auto-generated subdomain.");
      setInputValue("");
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove subdomain");
    }
  };

  // Determine display value
  const displaySubdomain = currentSubdomain || autoSubdomain || "Not set";
  const isUsingCustom = !!currentSubdomain;

  // Determine availability status
  const trimmedInput = inputValue.trim().toLowerCase();
  const isSameAsCurrent = trimmedInput === currentSubdomain;
  const hasInput = !!trimmedInput;
  const isCheckingAvailability = checkSubdomain.isPending;
  const isAvailable = !isSameAsCurrent && checkSubdomain.data?.available === true;
  const isUnavailable = !isSameAsCurrent && checkSubdomain.data?.available === false;
  const unavailableReason = checkSubdomain.data?.reason;

  // Determine if save is allowed
  const canSave =
    !localValidationError &&
    !isCheckingAvailability &&
    (isSameAsCurrent || !hasInput || isAvailable);

  if (!isEditing) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <code className="text-sm bg-muted px-2 py-1 rounded font-mono">
              {displaySubdomain}.{BASE_DOMAIN}
            </code>
            {isUsingCustom && (
              <span className="text-xs text-muted-foreground">(custom)</span>
            )}
            {!isUsingCustom && (
              <span className="text-xs text-muted-foreground">(auto-generated)</span>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            placeholder="your-subdomain"
            className="pr-24 font-mono text-sm"
            disabled={updateSubdomain.isPending}
            autoFocus
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            .{BASE_DOMAIN}
          </span>
        </div>

        {/* Status indicator */}
        <div className="w-6 flex items-center justify-center">
          {isCheckingAvailability && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {!isCheckingAvailability && hasInput && !isSameAsCurrent && !localValidationError && isAvailable && (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          {!isCheckingAvailability && hasInput && !isSameAsCurrent && (localValidationError || isUnavailable) && (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
        </div>
      </div>

      {/* Validation/availability message */}
      {localValidationError && (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {localValidationError}
        </p>
      )}
      {!localValidationError && isUnavailable && (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {unavailableReason || "This subdomain is not available"}
        </p>
      )}
      {!localValidationError && !isSameAsCurrent && isAvailable && (
        <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          This subdomain is available
        </p>
      )}
      {!hasInput && (
        <p className="text-sm text-muted-foreground">
          Leave empty to use your auto-generated subdomain: <code className="bg-muted px-1 rounded">{autoSubdomain}</code>
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateSubdomain.isPending || !canSave}
        >
          {updateSubdomain.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Save
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={updateSubdomain.isPending}
        >
          <X className="h-3.5 w-3.5 mr-1.5" />
          Cancel
        </Button>
        {currentSubdomain && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={updateSubdomain.isPending}
            className="text-muted-foreground hover:text-destructive ml-auto"
          >
            Remove custom subdomain
          </Button>
        )}
      </div>

      {/* Help text */}
      <p className="text-xs text-muted-foreground">
        3-50 characters. Lowercase letters, numbers, and hyphens only.
      </p>
    </div>
  );
}

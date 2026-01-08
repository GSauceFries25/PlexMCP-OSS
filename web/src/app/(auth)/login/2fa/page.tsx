"use client";

import { useState, Suspense, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { TwoFactorCodeInput } from "@/components/two-factor/TwoFactorCodeInput";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

// API URL for 2FA token request
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function TwoFactorVerifyForm() {
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestingToken, setIsRequestingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dynamicTempToken, setDynamicTempToken] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Note: supabase may be null if Supabase is not configured (self-hosted without OAuth)
  const supabase = createClient();
  const { mark2FAComplete } = useAuth();

  const urlTempToken = searchParams.get("temp_token");
  const tempToken = dynamicTempToken || urlTempToken;
  const userId = searchParams.get("user_id");
  const redirect = searchParams.get("redirect") || "/";
  const isOAuth = searchParams.get("oauth") === "true";
  const isPending = searchParams.get("pending") === "true";

  // Request a new temp token if we arrived with pending=true but no token
  const requestNewToken = useCallback(async () => {
    if (isRequestingToken) return;
    setIsRequestingToken(true);
    setError(null);

    try {
      // Get current session to make the 2FA check request
      // Note: If Supabase is not configured, we can't get OAuth session
      if (!supabase) {
        setError("OAuth is not configured. Please log in again.");
        router.push("/login");
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        setError("No active session. Please log in again.");
        router.push("/login");
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/auth/check-2fa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        setError("Failed to initialize 2FA. Please try again.");
        return;
      }

      const data = await response.json();

      if (data.status === "2fa_required" && data.temp_token) {
        setDynamicTempToken(data.temp_token);
      } else if (data.status === "ok") {
        // 2FA not required anymore, redirect to destination
        router.push(redirect);
      } else {
        setError("Unable to get 2FA token. Please try logging in again.");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsRequestingToken(false);
    }
  }, [isRequestingToken, supabase, router, redirect]);

  // Handle missing token - either request new one or redirect to login
  useEffect(() => {
    if (!urlTempToken && !dynamicTempToken) {
      if (isPending && isOAuth) {
        // Arrived via pending redirect, try to get a new token
        requestNewToken();
      } else {
        // No token and not a pending case, redirect to login
        router.push("/login");
      }
    }
  }, [urlTempToken, dynamicTempToken, isPending, isOAuth, router, requestNewToken]);

  // Check if it's a valid 6-digit code or backup code
  const isValidCode =
    /^\d{6}$/.test(code) || // TOTP code
    /^\d{4}-\d{4}$/.test(code) || // Legacy numeric backup code
    /^\d{8}$/.test(code) || // Legacy backup code without hyphen
    /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(code) || // New alphanumeric backup code
    /^[a-z0-9]{10}$/i.test(code); // New backup code without hyphen

  // Auto-submit when 6 digits are entered
  const handleCodeComplete = (completedCode: string) => {
    handleSubmit(undefined, completedCode);
  };

  const handleSubmit = async (e?: React.FormEvent, codeOverride?: string) => {
    e?.preventDefault();
    if (!tempToken || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    const codeToSubmit = codeOverride || code;

    try {
      const response = await apiClient.login2FA({
        temp_token: tempToken,
        code: codeToSubmit,
        remember_device: rememberDevice,
      });

      if (response.error || !response.data) {
        setError(response.error?.message || "Verification failed");
        return;
      }

      // SOC 2 CC6.1: Store device token in HttpOnly cookie (not localStorage)
      // This protects against XSS attacks that could steal the device token
      if (response.data.device_token) {
        try {
          await fetch("/api/auth/set-cookie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_token: response.data.device_token }),
            credentials: "include",
          });
        } catch (err) {
          console.warn("[2fa] Failed to store device token:", err);
        }
      }

      // For OAuth users, we already have a Supabase session
      // Just redirect to the destination
      if (isOAuth) {
        // Mark 2FA as complete in auth context to prevent re-prompting
        if (userId) {
          mark2FAComplete(userId);
        }
        toast.success("Verification successful!");
        router.push(redirect);
        router.refresh();
        return;
      }

      // For non-OAuth users, set the session with returned tokens
      // If Supabase is configured, set the Supabase session
      // Otherwise, we rely on HttpOnly cookies (already set by login endpoint)
      if (supabase) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
        });

        if (sessionError) {
          toast.error(sessionError.message);
          return;
        }
      } else {
        // For self-hosted without Supabase, set HttpOnly cookies for auth
        try {
          await fetch("/api/auth/set-cookie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: response.data.access_token,
              refresh_token: response.data.refresh_token,
            }),
            credentials: "include",
          });
          // Store user data for auth-provider
          localStorage.setItem("plexmcp_user", JSON.stringify(response.data.user));
        } catch (err) {
          console.warn("[2fa] Failed to set session cookie:", err);
        }
      }

      // Mark 2FA as complete in auth context to prevent re-prompting
      if (userId) {
        mark2FAComplete(userId);
      }

      toast.success("Welcome back!");
      router.push(redirect);
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading state while requesting token
  if (isRequestingToken) {
    return (
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>Initializing...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!tempToken) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid Request</CardTitle>
          <CardDescription>
            No verification token found. Please try logging in again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Link href="/login">
            <Button className="w-full">Return to Login</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Enter the verification code from your authenticator app to complete
          sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="2fa-code">Verification Code</Label>
            <TwoFactorCodeInput
              value={code}
              onChange={setCode}
              onComplete={handleCodeComplete}
              autoFocus
              disabled={isSubmitting}
              error={!!error}
            />
            <p className="text-xs text-muted-foreground">
              Enter your 6-digit code or a backup code
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember-device"
              checked={rememberDevice}
              onCheckedChange={(checked) => setRememberDevice(checked === true)}
              disabled={isSubmitting}
            />
            <Label
              htmlFor="remember-device"
              className="text-sm font-normal cursor-pointer"
            >
              Remember this device for 30 days
            </Label>
          </div>

          <div className="space-y-2">
            <Button
              type="submit"
              className="w-full"
              disabled={!isValidCode || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify and Sign In"
              )}
            </Button>

            <Link href="/login">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function TwoFactorVerifyPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Two-Factor Authentication
            </CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <TwoFactorVerifyForm />
    </Suspense>
  );
}

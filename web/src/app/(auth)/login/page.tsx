"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { apiClient, requires2FA, type TwoFactorRequiredResponse } from "@/lib/api/client";
import { TwoFactorLoginDialog } from "@/components/two-factor";
import { getSafeRedirectUrl } from "@/lib/utils";

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorData, setTwoFactorData] = useState<TwoFactorRequiredResponse | null>(null);
  const [is2FASubmitting, setIs2FASubmitting] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validate redirect URL to prevent open redirect attacks (SOC 2 CC6.1)
  const redirect = getSafeRedirectUrl(searchParams.get("redirect"));
  // Note: supabase may be null if Supabase is not configured (self-hosted without OAuth)
  const supabase = createClient();
  const oauthEnabled = isSupabaseConfigured() && supabase !== null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);

    try {
      // SOC 2 CC6.1: Get device token from HttpOnly cookie via API
      // Previously stored in localStorage (XSS vulnerable), now protected
      let deviceToken: string | undefined;
      try {
        const deviceTokenRes = await fetch("/api/auth/set-cookie", {
          method: "GET",
          credentials: "include",
        });
        if (deviceTokenRes.ok) {
          const deviceTokenData = await deviceTokenRes.json();
          deviceToken = deviceTokenData.device_token || undefined;
        }
      } catch (err) {
        console.warn("[login] Failed to get device token:", err);
      }

      // Migration: If device token exists in old localStorage, migrate it to HttpOnly cookie
      const oldDeviceToken = localStorage.getItem("device_token");
      if (oldDeviceToken && !deviceToken) {
        deviceToken = oldDeviceToken;
        // Migrate to HttpOnly cookie
        try {
          await fetch("/api/auth/set-cookie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_token: oldDeviceToken }),
            credentials: "include",
          });
          // Clear old localStorage entry after successful migration
          localStorage.removeItem("device_token");
        } catch (err) {
          console.warn("[login] Failed to migrate device token:", err);
        }
      } else if (oldDeviceToken && deviceToken) {
        // Cookie already exists, just clean up old localStorage
        localStorage.removeItem("device_token");
      }

      // Call our backend API for login (handles 2FA check)
      const response = await apiClient.login({
        email: data.email,
        password: data.password,
        device_token: deviceToken,
      });

      if (response.error || !response.data) {
        toast.error(response.error?.message || "Login failed");
        return;
      }

      // Check if 2FA is required
      if (requires2FA(response.data)) {
        setTwoFactorData(response.data);
        return;
      }

      // No 2FA required - store auth tokens securely
      // SOC 2 CC6.1: Defense-in-depth - HttpOnly cookies for middleware + localStorage for API client

      // Set HttpOnly cookies via server-side API route (prevents XSS access)
      const cookieRes = await fetch("/api/auth/set-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
        }),
        credentials: "include",
      });
      if (!cookieRes.ok) {
        // Log for debugging but don't block login - localStorage tokens still work
        console.warn("[login] set-cookie failed:", cookieRes.status);
      }

      // Store only non-sensitive user data in localStorage for UI purposes
      // SOC 2 CC6.1: Auth tokens are stored in HttpOnly cookies only (set above)
      // localStorage is XSS-vulnerable, so we don't store tokens there
      localStorage.setItem("plexmcp_user", JSON.stringify(response.data.user));

      // Set the token in API client
      apiClient.setAccessToken(response.data.access_token);

      toast.success("Welcome back!");

      // Small delay to ensure storage is flushed before navigation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Use window.location.href for full page reload
      // This ensures AuthProvider re-mounts and finds the new tokens
      // router.push() does client-side navigation which keeps AuthProvider state
      window.location.href = redirect;
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handle2FAComplete = async (accessToken: string, refreshToken: string) => {
    try {
      // SOC 2 CC6.1: Defense-in-depth - set HttpOnly cookies for middleware
      const cookieRes = await fetch("/api/auth/set-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
        }),
        credentials: "include",
      });
      if (!cookieRes.ok) {
        console.warn("[login] 2FA set-cookie failed:", cookieRes.status);
      }

      // Set the token in API client for immediate use
      apiClient.setAccessToken(accessToken);

      // Fetch user data to store for auth-provider (non-sensitive, UI purposes only)
      // SOC 2 CC6.1: Only user data in localStorage, tokens in HttpOnly cookies
      try {
        const userResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/me`, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });
        if (userResponse.ok) {
          const userData = await userResponse.json();
          localStorage.setItem("plexmcp_user", JSON.stringify(userData));
        }
      } catch (err) {
        console.warn("[login] Failed to fetch user data after 2FA:", err);
      }

      setTwoFactorData(null);
      toast.success("Welcome back!");

      await new Promise(resolve => setTimeout(resolve, 100));
      // Use window.location.href for full page reload (same as regular login)
      window.location.href = redirect;
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    }
  };

  const handle2FASubmit = async (code: string, rememberDevice: boolean) => {
    if (!twoFactorData) return;

    setIs2FASubmitting(true);
    setTwoFactorError(null);

    try {
      const response = await apiClient.login2FA({
        temp_token: twoFactorData.temp_token,
        code,
        remember_device: rememberDevice,
      });

      if (response.error || !response.data) {
        setTwoFactorError(response.error?.message || "Verification failed");
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
          console.warn("[login] Failed to store device token:", err);
        }
      }

      // 2FA verified - complete login with tokens
      await handle2FAComplete(response.data.access_token, response.data.refresh_token);
    } catch {
      setTwoFactorError("An unexpected error occurred. Please try again.");
    } finally {
      setIs2FASubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!supabase) {
      toast.error("OAuth is not configured for this deployment");
      return;
    }

    setIsLoading(true);
    const redirectTo = `${window.location.origin}/callback?redirect=${encodeURIComponent(redirect)}`;

    try {
      // Log OAuth initiation for audit trail (SOC 2 compliance)
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/audit/oauth-initiated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          redirect_url: redirectTo,
        }),
      }).catch(err => console.error("[Audit] Failed to log OAuth initiation:", err));

      // Clear ONLY the stale code_verifier before starting new OAuth
      // This ensures fresh PKCE state without clearing the entire session
      // See DEBUG_OAUTH.md Attempt 13 for details
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
        const codeVerifierKey = `sb-${projectRef}-auth-token-code-verifier`;
        const oldVerifier = localStorage.getItem(codeVerifierKey);
        if (oldVerifier) {
          localStorage.removeItem(codeVerifierKey);
        }
      }

      // Note: Supabase handles PKCE and state internally for CSRF protection
      // Do NOT pass custom state - it breaks Supabase's internal OAuth flow
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });

      if (error) {
        toast.error(error.message);
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubSignIn = async () => {
    if (!supabase) {
      toast.error("OAuth is not configured for this deployment");
      return;
    }

    setIsLoading(true);
    const redirectTo = `${window.location.origin}/callback?redirect=${encodeURIComponent(redirect)}`;

    try {
      // Log OAuth initiation for audit trail (SOC 2 compliance)
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/audit/oauth-initiated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          redirect_url: redirectTo,
        }),
      }).catch(err => console.error("[Audit] Failed to log OAuth initiation:", err));

      // Clear ONLY the stale code_verifier before starting new OAuth
      // This ensures fresh PKCE state without clearing the entire session
      // See DEBUG_OAUTH.md Attempt 13 for details
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
        const codeVerifierKey = `sb-${projectRef}-auth-token-code-verifier`;
        const oldVerifier = localStorage.getItem(codeVerifierKey);
        if (oldVerifier) {
          localStorage.removeItem(codeVerifierKey);
        }
      }

      // Note: Supabase handles PKCE and state internally for CSRF protection
      // Do NOT pass custom state - it breaks Supabase's internal OAuth flow
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo,
        },
      });

      if (error) {
        toast.error(error.message);
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>
      <CardContent className="space-y-4">
        {/* OAuth buttons - only shown if Supabase is configured */}
        {oauthEnabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGitHubSignIn}
                disabled={isLoading}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                GitHub
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with email
                </span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              {...register("email")}
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                {...register("password")}
                disabled={isLoading}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground text-center w-full">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </CardFooter>
      </Card>

      {/* Two-Factor Authentication Dialog */}
      <TwoFactorLoginDialog
        open={!!twoFactorData}
        onOpenChange={(open) => {
          if (!open) {
            setTwoFactorData(null);
            setTwoFactorError(null);
          }
        }}
        onSubmit={handle2FASubmit}
        isSubmitting={is2FASubmitting}
        error={twoFactorError}
      />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    }>
      <LoginForm />
    </Suspense>
  );
}

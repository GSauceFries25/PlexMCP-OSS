"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, AlertCircle, CheckCircle2, Mail, Eye, EyeOff } from "lucide-react";
import { apiClient } from "@/lib/api/client";

// Types for invitation validation
interface InvitationValidation {
  valid: boolean;
  org_name: string | null;
  inviter_name: string | null;
  email: string | null;
  role: string | null;
  expires_at: string | null;
}

// Accept invitation response type
interface AcceptResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    role: string;
    org_id: string;
    org_name: string;
  };
}

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain at least one uppercase letter, one lowercase letter, and one number"
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type PasswordFormData = z.infer<typeof passwordSchema>;

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [state, setState] = useState<"loading" | "invalid" | "valid" | "accepting">("loading");
  const [invitation, setInvitation] = useState<InvitationValidation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptMethod, setAcceptMethod] = useState<"password" | "oauth" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Note: supabase may be null if Supabase is not configured (self-hosted without OAuth)
  const supabase = createClient();
  const oauthEnabled = isSupabaseConfigured() && supabase !== null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  // Validate the invitation token on mount
  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setState("invalid");
        return;
      }

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/v1/invitations/validate?token=${encodeURIComponent(token)}`
        );

        if (!response.ok) {
          setState("invalid");
          return;
        }

        const data: InvitationValidation = await response.json();

        if (!data.valid) {
          setInvitation(data);
          setState("invalid");
          return;
        }

        setInvitation(data);
        setState("valid");
      } catch {
        setState("invalid");
      }
    }

    validateToken();
  }, [token]);

  // Handle password-based acceptance
  const onSubmitPassword = async (data: PasswordFormData) => {
    if (!token) return;

    setIsSubmitting(true);
    setState("accepting");

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/v1/invitations/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            password: data.password,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || errorData.message || "Failed to accept invitation");
      }

      const result: AcceptResponse = await response.json();

      // Set session - use Supabase if configured, otherwise use HttpOnly cookies
      if (supabase) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });

        if (sessionError) {
          throw new Error(sessionError.message);
        }
      } else {
        // For self-hosted without Supabase, set HttpOnly cookies for auth
        try {
          await fetch("/api/auth/set-cookie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: result.access_token,
              refresh_token: result.refresh_token,
            }),
            credentials: "include",
          });
          // Store user data for auth-provider
          localStorage.setItem("plexmcp_user", JSON.stringify(result.user));
        } catch (err) {
          console.warn("[accept-invite] Failed to set session cookie:", err);
        }
      }

      // Also store in apiClient for immediate API calls
      apiClient.setAccessToken(result.access_token);

      toast.success(`Welcome to ${result.user.org_name}!`);
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept invitation");
      setState("valid");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle OAuth-based acceptance
  const handleOAuthAccept = async (provider: "google" | "github") => {
    if (!token) return;

    if (!supabase) {
      toast.error("OAuth is not configured for this deployment");
      return;
    }

    setIsSubmitting(true);

    try {
      // Store token in sessionStorage for the callback
      sessionStorage.setItem("invitation_token", token);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/accept-invite/callback?token=${encodeURIComponent(token)}`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign in with OAuth");
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (state === "loading") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Validating invitation...</p>
        </CardContent>
      </Card>
    );
  }

  // Invalid invitation
  if (state === "invalid") {
    const isExpired = invitation?.expires_at && new Date(invitation.expires_at) < new Date();
    const hasOrgName = invitation?.org_name;

    return (
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl">
            {isExpired ? "Invitation Expired" : "Invalid Invitation"}
          </CardTitle>
          <CardDescription>
            {isExpired
              ? `This invitation to join ${hasOrgName || "the organization"} has expired.`
              : "This invitation link is invalid or has already been used."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isExpired && (
            <p className="text-sm text-muted-foreground text-center">
              Please ask the person who invited you to send a new invitation.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button asChild variant="default">
              <Link href="/login">Go to Login</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">Create New Account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Accepting state
  if (state === "accepting") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Setting up your account...</p>
        </CardContent>
      </Card>
    );
  }

  // Valid invitation - show acceptance form
  const roleDisplay = invitation?.role === "admin" ? "Admin" : invitation?.role === "viewer" ? "Viewer" : "Member";

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl">Join {invitation?.org_name}</CardTitle>
        <CardDescription>
          {invitation?.inviter_name
            ? `${invitation.inviter_name} invited you to join as ${roleDisplay}`
            : `You've been invited to join as ${roleDisplay}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email display */}
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <p className="text-sm text-muted-foreground">You&apos;re joining as</p>
          <p className="font-medium">{invitation?.email}</p>
        </div>

        {/* Method selection or form */}
        {!acceptMethod ? (
          <div className="space-y-4">
            <p className="text-sm text-center text-muted-foreground">
              {oauthEnabled ? "Choose how to set up your account" : "Set up your account"}
            </p>

            {/* OAuth buttons - only shown if Supabase is configured */}
            {oauthEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleOAuthAccept("google")}
                    disabled={isSubmitting}
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
                    onClick={() => handleOAuthAccept("github")}
                    disabled={isSubmitting}
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
                      Or set a password
                    </span>
                  </div>
                </div>
              </>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAcceptMethod("password")}
              disabled={isSubmitting}
            >
              Create Password
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmitPassword)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  {...register("password")}
                  disabled={isSubmitting}
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
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  {...register("confirmPassword")}
                  disabled={isSubmitting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setAcceptMethod(null)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Join Team
              </Button>
            </div>
          </form>
        )}

        <p className="text-xs text-muted-foreground text-center">
          By joining, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-primary">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-primary">
            Privacy Policy
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

// API URL for backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * OAuth callback page - handles PKCE code exchange
 */
function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Processing authentication...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");
      const redirect = searchParams.get("redirect") || "/";

      // Note: OAuth state/CSRF protection is handled by Supabase's PKCE flow
      // We don't need custom state validation

      if (errorParam) {
        // Log OAuth callback error for audit trail (SOC 2 compliance)
        await fetch(`${API_URL}/api/v1/audit/oauth-callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "unknown",
            has_auth_code: false,
            error: `${errorParam}: ${errorDescription}`,
          }),
        }).catch(err => console.error("[Audit] Failed to log OAuth callback error:", err));

        setError(`OAuth error: ${errorParam} - ${errorDescription}`);
        return;
      }

      if (!code) {
        setError("No authorization code received");
        return;
      }

      // Check if Supabase is configured - OAuth requires Supabase
      if (!isSupabaseConfigured()) {
        setError("OAuth is not configured for this deployment. Please use email/password login.");
        return;
      }

      // Log OAuth callback received for audit trail (SOC 2 compliance)
      // Note: We don't know the provider yet, but we can detect it from user metadata after exchange
      await fetch(`${API_URL}/api/v1/audit/oauth-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "unknown", // Will be determined after session exchange
          has_auth_code: true,
          error: errorParam || null,
        }),
      }).catch(err => console.error("[Audit] Failed to log OAuth callback:", err));

      setStatus("Exchanging authorization code...");
      const supabase = createClient();

      if (!supabase) {
        setError("OAuth client initialization failed. Please try again.");
        return;
      }

      try {
        // Exchange authorization code for session
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          setError(`Authentication failed: ${exchangeError.message}`);
          return;
        }

        if (!exchangeData?.session) {
          setError("Authentication failed: No session returned from exchange");
          return;
        }

        // Detect OAuth provider from user metadata
        const provider = exchangeData.user?.app_metadata?.provider || "unknown";
        const email = exchangeData.user?.email || "unknown@example.com";
        const sessionId = exchangeData.session?.access_token?.substring(0, 16);

        // Check if this is a new user (created_at is recent)
        const userCreatedAt = exchangeData.user?.created_at ? new Date(exchangeData.user.created_at) : null;
        const isNewUser = userCreatedAt ? (Date.now() - userCreatedAt.getTime()) < 60000 : false; // Within last 60 seconds

        // Log OAuth session creation for audit trail (SOC 2 compliance)
        await fetch(`${API_URL}/api/v1/audit/oauth-session-created`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            email,
            session_id: sessionId,
            is_new_user: isNewUser,
          }),
        }).catch(err => console.error("[Audit] Failed to log OAuth session creation:", err));

        // Set session cookies for middleware authentication
        const session = exchangeData.session;

        try {
          await fetch("/api/auth/set-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }),
          });
        } catch {
          // Continue even if cookie setting fails - localStorage fallback available
        }

        // Get the session to continue
        const { data: { session: sessionData } } = await supabase.auth.getSession();

        if (!sessionData) {
          setError("Authentication failed: No session returned");
          return;
        }

        // Check 2FA requirement
        setStatus("Checking 2FA requirements...");
        const accessToken = sessionData.access_token;

        try {
          const response = await fetch(`${API_URL}/api/v1/auth/check-2fa`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (response.ok) {
            const data = await response.json();

            if (data.status === "2fa_required" && data.temp_token) {
              const tempToken = encodeURIComponent(data.temp_token);
              const userId = encodeURIComponent(data.user_id || "");
              const redirectEncoded = encodeURIComponent(redirect);
              router.push(
                `/login/2fa?temp_token=${tempToken}&user_id=${userId}&redirect=${redirectEncoded}&oauth=true`
              );
              return;
            }
          }
        } catch {
          // Continue without 2FA if check fails
        }

        // Success - redirect to dashboard
        setStatus("Authentication successful! Redirecting...");
        window.location.href = redirect;
      } catch {
        setError("An unexpected error occurred during authentication");
      }
    };

    handleCallback();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-red-500 text-lg font-semibold">
            Authentication Failed
          </div>
          <div className="text-muted-foreground max-w-md px-4">{error}</div>
          <div className="text-sm text-muted-foreground">
            Try clearing your browser cookies and attempting login again.
          </div>
          <button
            onClick={() => router.push("/login")}
            className="text-primary hover:underline"
          >
            Return to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <div className="text-muted-foreground">{status}</div>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <div className="text-muted-foreground">Loading...</div>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Dashboard URL must be configured via environment variable for self-hosted deployments
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000";

export function OAuthHandler() {
  const searchParams = useSearchParams();
  const [isHandling, setIsHandling] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";

    // Handle OAuth redirects on any configured domain
    // When OAuth redirects here with a code, we forward it to the dashboard
    // The code exchange must happen on the dashboard because PKCE code_verifier
    // is stored in dashboard's local storage
    const configuredDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "localhost";
    const isMainDomain = hostname === configuredDomain ||
                         hostname === `www.${configuredDomain}` ||
                         hostname === "localhost" ||
                         hostname.startsWith("localhost:");
    if (code && isMainDomain) {
      forwardToDashboard(code);
    }
  }, [searchParams]);

  const forwardToDashboard = (code: string) => {
    if (isHandling) return;
    setIsHandling(true);

    console.log("[OAuthHandler] Forwarding OAuth code to dashboard...");

    // Forward the code to the dashboard's client-side callback page
    // This ensures the PKCE flow completes on the correct domain with browser access to verifier
    window.location.href = `${DASHBOARD_URL}/callback?code=${encodeURIComponent(code)}`;
  };

  // Don't render anything
  return null;
}

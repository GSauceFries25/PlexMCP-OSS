/**
 * API Route: Server-side Logout
 *
 * SOC 2 CC6.1: Proper session termination
 *
 * This endpoint handles complete logout by:
 * 1. Clearing our custom HttpOnly auth cookies
 * 2. Clearing Supabase session cookies (with correct domain for cross-subdomain)
 * 3. Invalidating the Supabase session server-side
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Get cookie domain for cross-subdomain auth
function getCookieDomain(hostname: string): string | undefined {
  // Get configured base domain from environment
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN;

  // In production with configured domain, set cookie domain for subdomain sharing
  if (baseDomain && (hostname.endsWith(`.${baseDomain}`) || hostname === baseDomain)) {
    return `.${baseDomain}`;
  }
  // In development or self-hosted without custom domain, don't set domain (use default)
  return undefined;
}

export async function POST(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const cookieDomain = getCookieDomain(hostname);

  // Create Supabase server client to sign out server-side
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // We'll handle cookie clearing manually below
        },
      },
    }
  );

  // Sign out from Supabase (invalidates the session server-side)
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("[logout] Supabase signOut error:", error);
    // Continue even if this fails - we'll clear cookies anyway
  }

  const response = NextResponse.json({ success: true });

  // Cookie options for clearing
  const clearCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };

  // Clear our custom auth cookies
  response.cookies.set("plexmcp_auth_token", "", clearCookieOptions);
  response.cookies.set("plexmcp_refresh_token", "", clearCookieOptions);
  response.cookies.set("plexmcp_device_token", "", clearCookieOptions);

  // Clear Supabase auth cookies (these are the common cookie names Supabase uses)
  // The cookie name follows the pattern: sb-{project-ref}-auth-token
  const supabaseProjectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /https:\/\/([^.]+)\./
  )?.[1];

  if (supabaseProjectRef) {
    // Main auth token cookie
    response.cookies.set(
      `sb-${supabaseProjectRef}-auth-token`,
      "",
      clearCookieOptions
    );
    // Also try without httpOnly for the base cookie (Supabase might not use httpOnly)
    response.cookies.set(`sb-${supabaseProjectRef}-auth-token`, "", {
      ...clearCookieOptions,
      httpOnly: false,
    });
  }

  // Also clear any cookies without domain (in case they were set that way)
  const clearWithoutDomain = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };

  response.cookies.set("plexmcp_auth_token", "", clearWithoutDomain);
  response.cookies.set("plexmcp_refresh_token", "", clearWithoutDomain);

  if (supabaseProjectRef) {
    response.cookies.set(
      `sb-${supabaseProjectRef}-auth-token`,
      "",
      clearWithoutDomain
    );
  }

  console.log("[logout] Cleared all auth cookies");

  return response;
}

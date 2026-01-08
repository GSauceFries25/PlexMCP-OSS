import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";

/**
 * SOC 2 CC6.1: Origin header validation for defense-in-depth
 * Uses Origin validation instead of CSRF token since this is called
 * immediately after OAuth callback (no CSRF cookie exists yet)
 */
function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  // Configurable origins, defaults to localhost for development/self-hosted
  const envOrigins = process.env.NEXT_PUBLIC_ALLOWED_ORIGINS;
  const allowedOrigins = envOrigins
    ? envOrigins.split(",").map(o => o.trim())
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ];

  // Check exact match or subdomain match for configured base domain
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN;
  return allowedOrigins.some(
    (allowed) => origin === allowed || (baseDomain && origin.endsWith(`.${baseDomain}`))
  );
}

/**
 * API route to set auth session cookies
 * Called by callback page after OAuth exchange
 * Uses @supabase/ssr to ensure cookies are in correct format for middleware
 *
 * Security: Uses Origin validation for CSRF protection since this is called
 * immediately after OAuth callback. The access_token itself provides
 * authentication (only someone who completed OAuth has valid tokens).
 *
 * SOC 2 CC6.1 Compliance: Origin validation + access_token authentication
 */
export async function POST(request: NextRequest) {
  try {
    // SOC 2 CC6.1: Validate Origin header for CSRF protection
    if (!validateOrigin(request)) {
      console.warn("[set-session] Origin validation failed:", request.headers.get("origin"));
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { access_token, refresh_token } = body;

    if (!access_token || !refresh_token) {
      return NextResponse.json(
        { error: "Missing tokens" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();

    // Create Supabase client with cookie handling
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    // Set the session using the tokens
    const { data, error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error("[API set-session] Error setting session:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // Session set successfully - don't log email in production

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[API set-session] Unexpected error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

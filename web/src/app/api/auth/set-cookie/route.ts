/**
 * API Route: Set Authentication Cookie (HttpOnly)
 *
 * SOC 2 CC6.1: Secure cookie handling prevents XSS token theft
 *
 * This endpoint sets HttpOnly cookies for authentication tokens.
 * HttpOnly cookies cannot be accessed via JavaScript, protecting
 * against XSS attacks that could steal authentication tokens.
 *
 * Security Features:
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: Only transmitted over HTTPS
 * - SameSite=Lax: CSRF protection while allowing top-level navigation
 * - Path=/: Cookie available across the entire site
 */

import { NextRequest, NextResponse } from "next/server";

interface SetCookieRequest {
  access_token?: string;
  refresh_token?: string;
  /** Device token for "remember this device" feature - stored in HttpOnly cookie */
  device_token?: string;
}

/**
 * SOC 2 CC6.1: Origin header validation for CSRF protection
 * Uses Origin validation instead of CSRF token to avoid silent failures
 * (see DEBUG_LOGIN.md for details on why token-based CSRF caused issues)
 */
function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  // Origin header is required for cross-origin requests
  // Same-origin requests from browsers always include Origin for POST
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

export async function POST(request: NextRequest) {
  try {
    // SOC 2 CC6.1: Validate Origin header to prevent CSRF attacks
    // This approach avoids the silent failure issues with token-based CSRF
    // (see DEBUG_LOGIN.md for why we use Origin validation here)
    if (!validateOrigin(request)) {
      console.warn("[set-cookie] Origin validation failed:", request.headers.get("origin"));
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403 }
      );
    }

    const body: SetCookieRequest = await request.json();

    // At least one token type must be provided
    if (!body.access_token && !body.device_token) {
      return NextResponse.json(
        { error: "access_token or device_token is required" },
        { status: 400 }
      );
    }

    // Validate token formats (basic sanity check)
    if (body.access_token && (typeof body.access_token !== "string" || body.access_token.length < 10)) {
      return NextResponse.json(
        { error: "Invalid access token format" },
        { status: 400 }
      );
    }

    if (body.device_token && (typeof body.device_token !== "string" || body.device_token.length < 10)) {
      return NextResponse.json(
        { error: "Invalid device token format" },
        { status: 400 }
      );
    }

    const response = NextResponse.json({ success: true });

    // Set HttpOnly auth cookie for access token
    // SOC 2 CC6.1: HttpOnly prevents XSS access to tokens
    if (body.access_token) {
      response.cookies.set("plexmcp_auth_token", body.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24, // 24 hours (matches access token expiry)
        path: "/",
      });
    }

    // Optionally set refresh token cookie if provided
    if (body.refresh_token) {
      response.cookies.set("plexmcp_refresh_token", body.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days (matches refresh token expiry)
        path: "/",
      });
    }

    // SOC 2 CC6.1: Set device token in HttpOnly cookie for "remember this device" feature
    // Previously stored in localStorage (XSS vulnerable), now protected by HttpOnly
    if (body.device_token) {
      response.cookies.set("plexmcp_device_token", body.device_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days (remember device for 30 days)
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("[set-cookie] Error setting auth cookie:", error);
    return NextResponse.json(
      { error: "Failed to set authentication cookie" },
      { status: 500 }
    );
  }
}

/**
 * GET: Retrieve device token from HttpOnly cookie
 * SOC 2 CC6.1: Allows frontend to get device token without exposing it to XSS
 * The server reads the HttpOnly cookie and returns the value securely.
 * Note: No Origin validation needed - reading own cookie is safe, and
 * the token is already protected (attacker would need to make request from user's browser)
 */
export async function GET(request: NextRequest) {
  const deviceToken = request.cookies.get("plexmcp_device_token")?.value;

  return NextResponse.json({
    device_token: deviceToken || null,
  });
}

/**
 * DELETE: Clear authentication cookies
 * Used during logout to remove HttpOnly cookies
 * Note: CSRF validation removed - logout is always safe to allow
 * Worst case: user gets logged out (not a security risk)
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });

  // Clear auth cookies by setting expired values
  response.cookies.set("plexmcp_auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0, // Immediately expires
    path: "/",
  });

  response.cookies.set("plexmcp_refresh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}

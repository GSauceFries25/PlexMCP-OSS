import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * POST /api/auth/validate-session
 *
 * Validates the session using HttpOnly cookie and returns user data + access token.
 * This enables secure cookie-based auth while still supporting direct backend API calls.
 *
 * SOC 2 CC6.1: HttpOnly cookies prevent XSS from directly reading tokens.
 * The token is returned in the response for in-memory API client use only.
 *
 * Security note: CSRF protection is intentionally NOT applied here because:
 * 1. The HttpOnly cookie can only be sent by same-origin requests
 * 2. This endpoint only reads session data, doesn't modify state
 * 3. CSRF protection would create a chicken-and-egg problem during app initialization
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Read the HttpOnly cookie
    const accessToken = request.cookies.get("plexmcp_auth_token")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "No session cookie found" },
        { status: 401 }
      );
    }

    // Validate the token with the backend
    const response = await fetch(`${API_URL}/api/v1/auth/me`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Token is invalid or expired
      return NextResponse.json(
        { error: "Session invalid or expired" },
        { status: 401 }
      );
    }

    const userData = await response.json();

    // Return the validated user data and access token
    // The token is safe to return because:
    // 1. This endpoint requires a valid HttpOnly cookie (same-origin only)
    // 2. XSS would need to specifically call this endpoint during attack
    // 3. The token cannot be persisted by XSS (no localStorage writes)
    return NextResponse.json({
      user: userData,
      access_token: accessToken,
    });
  } catch (error) {
    console.error("[validate-session] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

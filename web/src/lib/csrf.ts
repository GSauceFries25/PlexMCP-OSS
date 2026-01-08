/**
 * CSRF Protection Utilities
 *
 * Implements the Double-Submit Cookie pattern for CSRF protection:
 * 1. Server generates a cryptographically random token
 * 2. Token is stored in a cookie (HttpOnly=false so JS can read it)
 * 3. Client includes token in X-CSRF-Token header on state-changing requests
 * 4. Server validates that cookie token matches header token
 *
 * This works because:
 * - Attacker sites cannot read our cookies (same-origin policy)
 * - Attacker sites cannot set our cookies (SameSite=Strict)
 * - Therefore attacker cannot send matching cookie + header
 *
 * SOC 2 CC6.1 Compliance: Protects against cross-site request forgery attacks
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Constants
export const CSRF_COOKIE_NAME = "plexmcp_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_LENGTH = 32; // 256 bits of entropy

// Allowed origins for CSRF validation
// SOC 2 CC6.1: Configurable origins, defaults to localhost for development/self-hosted
const ALLOWED_ORIGINS = (() => {
  const envOrigins = process.env.NEXT_PUBLIC_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(",").map(o => o.trim());
  }
  // Default to localhost for development/self-hosted
  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
  ];
})();

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  // Use Web Crypto API for secure random generation
  const array = new Uint8Array(CSRF_TOKEN_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Get the CSRF token from cookies, generating a new one if needed
 * For use in Server Components and API Routes
 */
export async function getCsrfToken(): Promise<string> {
  const cookieStore = await cookies();
  let token = cookieStore.get(CSRF_COOKIE_NAME)?.value;

  if (!token) {
    token = generateCsrfToken();
  }

  return token;
}

/**
 * Set the CSRF token cookie in a response
 */
export function setCsrfCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be false so client JS can read and send in header
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict", // Prevents cookie from being sent in cross-site requests
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });
  return response;
}

/**
 * Validate the Origin header against allowed origins
 * Returns true if origin is valid, false otherwise
 */
export function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // For same-origin requests, Origin may not be present
  // In this case, check Referer header
  // SOC 2 CC6.1: Fail closed when origin cannot be determined
  if (!origin) {
    if (!referer) {
      // Both missing - could be a malicious request without origin headers
      // Fail closed for security - legitimate same-origin requests should have referer
      console.warn("[CSRF] Denying request with no Origin or Referer headers");
      return false;
    }

    try {
      const refererUrl = new URL(referer);
      return ALLOWED_ORIGINS.some(allowed => {
        const allowedUrl = new URL(allowed);
        return refererUrl.origin === allowedUrl.origin;
      });
    } catch {
      return false;
    }
  }

  // Check if origin is in allowed list
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Validate CSRF token from request
 * Compares the token in the cookie with the token in the header
 */
export function validateCsrfToken(request: NextRequest): { valid: boolean; reason?: string } {
  // Skip CSRF validation for safe methods (GET, HEAD, OPTIONS)
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return { valid: true };
  }

  // First, validate origin
  if (!validateOrigin(request)) {
    return { valid: false, reason: "Invalid origin" };
  }

  // Get token from cookie
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!cookieToken) {
    return { valid: false, reason: "Missing CSRF cookie" };
  }

  // Get token from header
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!headerToken) {
    return { valid: false, reason: "Missing CSRF header" };
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(cookieToken, headerToken)) {
    return { valid: false, reason: "CSRF token mismatch" };
  }

  return { valid: true };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * CSRF validation middleware wrapper for API route handlers
 * Use this to wrap your POST/PUT/DELETE handlers
 *
 * @example
 * export const POST = withCsrfProtection(async (request) => {
 *   // Your handler code here
 *   return NextResponse.json({ success: true });
 * });
 */
export function withCsrfProtection(
  handler: (request: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return async (request: NextRequest, context?: unknown): Promise<NextResponse> => {
    const validation = validateCsrfToken(request);

    if (!validation.valid) {
      console.warn(`[CSRF] Validation failed: ${validation.reason}`, {
        path: request.nextUrl.pathname,
        method: request.method,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });

      return NextResponse.json(
        {
          error: "CSRF validation failed",
          code: "CSRF_VALIDATION_FAILED",
          message: validation.reason,
        },
        { status: 403 }
      );
    }

    return handler(request, context);
  };
}

/**
 * Create a response with a fresh CSRF token
 * Use this when returning responses that should refresh the CSRF token
 */
export function responseWithCsrfToken<T>(
  data: T,
  options?: { status?: number }
): NextResponse {
  const token = generateCsrfToken();
  const response = NextResponse.json(data, { status: options?.status ?? 200 });
  return setCsrfCookie(response, token);
}

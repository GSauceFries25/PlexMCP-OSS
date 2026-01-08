import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * SOC 2 CC6.1: Allowed origins for analytics collection
 * Configurable via NEXT_PUBLIC_ALLOWED_ORIGINS, defaults to localhost
 */
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
 * Check if origin is allowed (exact match or configured base domain subdomain)
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN;
  return ALLOWED_ORIGINS.includes(origin) || (baseDomain ? origin.endsWith(`.${baseDomain}`) : false);
}

/**
 * Get CORS origin header value for a request
 */
function getCorsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (isAllowedOrigin(origin)) {
    return origin;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // SOC 2 CC6.1: Validate Origin header to prevent cross-site analytics injection
    const origin = request.headers.get("origin");
    if (!isAllowedOrigin(origin)) {
      console.warn("[Analytics] Origin validation failed:", origin);
      return new NextResponse(null, { status: 204 }); // Silent failure for analytics
    }

    const body = await request.json();

    // Get client IP from headers (for geolocation on backend)
    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const clientIp = forwardedFor?.split(",")[0] || realIp || "unknown";

    // Get user agent
    const userAgent = request.headers.get("user-agent") || "";

    // Forward to backend API
    const response = await fetch(`${API_URL}/api/v1/analytics/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": clientIp,
        "X-Real-IP": clientIp,
        "User-Agent": userAgent,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // If backend returns an error, just return 204 to not break the page
      // Analytics failures should be silent
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json().catch(() => null);
    return NextResponse.json(data || { success: true });
  } catch (error) {
    // Analytics should fail silently - don't break the user experience
    console.error("[Analytics Proxy] Error:", error);
    return new NextResponse(null, { status: 204 });
  }
}

// Handle OPTIONS for CORS preflight
// SOC 2 CC6.1: Use explicit origin instead of wildcard
export async function OPTIONS(request: NextRequest) {
  const corsOrigin = getCorsOrigin(request);

  // If origin isn't allowed, return 204 without CORS headers
  if (!corsOrigin) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

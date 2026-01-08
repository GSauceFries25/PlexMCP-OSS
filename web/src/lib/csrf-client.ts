/**
 * Client-side CSRF Token Management
 *
 * This module provides utilities for managing CSRF tokens on the client side.
 * It works with the server-side CSRF protection in /lib/csrf.ts.
 *
 * Usage:
 * 1. Call ensureCsrfToken() once on app initialization
 * 2. Use getCsrfHeaders() to get headers for state-changing requests
 *
 * SOC 2 CC6.1 Compliance: Client-side CSRF protection
 */

// Constants (duplicated from csrf.ts to avoid server-side imports)
export const CSRF_COOKIE_NAME = "plexmcp_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

// Cache the token to avoid repeated cookie parsing
let cachedToken: string | null = null;

/**
 * Get the CSRF token from the cookie
 */
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === CSRF_COOKIE_NAME) {
      cachedToken = value;
      return value;
    }
  }

  return null;
}

/**
 * Fetch a fresh CSRF token from the server
 * This also sets the cookie via the response
 */
export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch("/api/csrf", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch CSRF token");
  }

  const data = await response.json();
  cachedToken = data.token;
  return data.token;
}

/**
 * Ensure we have a valid CSRF token
 * Returns existing token from cookie or fetches a new one
 */
export async function ensureCsrfToken(): Promise<string> {
  // Check if we have a cached token
  if (cachedToken) {
    return cachedToken;
  }

  // Check if token exists in cookie
  const existingToken = getCsrfTokenFromCookie();
  if (existingToken) {
    return existingToken;
  }

  // Fetch a new token
  return fetchCsrfToken();
}

/**
 * Get headers object with CSRF token for state-changing requests
 * Use this with fetch() calls to protected endpoints
 *
 * @example
 * const headers = await getCsrfHeaders();
 * fetch('/api/billing/invoices/123/pay', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     ...headers,
 *   },
 * });
 */
export async function getCsrfHeaders(): Promise<Record<string, string>> {
  const token = await ensureCsrfToken();
  return {
    [CSRF_HEADER_NAME]: token,
  };
}

/**
 * Wrapper for fetch that automatically includes CSRF token
 * Use this for state-changing requests (POST, PUT, DELETE, PATCH)
 *
 * @example
 * const response = await csrfFetch('/api/billing/invoices/123/pay', {
 *   method: 'POST',
 *   body: JSON.stringify({ amount: 100 }),
 * });
 */
export async function csrfFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();

  // Only add CSRF token for state-changing methods
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const csrfHeaders = await getCsrfHeaders();
    options.headers = {
      ...options.headers,
      ...csrfHeaders,
    };
  }

  // Always include credentials for cookie handling
  options.credentials = options.credentials || "include";

  return fetch(url, options);
}

/**
 * Initialize CSRF protection on page load
 * Call this in your app's initialization or in a useEffect
 */
export async function initCsrfProtection(): Promise<void> {
  try {
    await ensureCsrfToken();
  } catch (error) {
    console.warn("[CSRF] Failed to initialize CSRF token:", error);
  }
}

/**
 * Clear the cached token (useful for logout)
 */
export function clearCsrfToken(): void {
  cachedToken = null;
}

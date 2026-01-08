/**
 * CSRF Token API Endpoint
 *
 * GET /api/csrf - Returns a fresh CSRF token
 *
 * The token is also set as a cookie so subsequent requests
 * can include it in the X-CSRF-Token header for validation.
 *
 * SOC 2 CC6.1 Compliance: CSRF protection mechanism
 */

import { NextResponse } from "next/server";
import { generateCsrfToken, setCsrfCookie, CSRF_COOKIE_NAME } from "@/lib/csrf";

export async function GET() {
  const token = generateCsrfToken();

  const response = NextResponse.json({
    token,
    cookie_name: CSRF_COOKIE_NAME,
  });

  return setCsrfCookie(response, token);
}

import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that require authentication
const protectedRoutes = [
  "/mcps",
  "/connections",
  "/api-keys",
  "/billing",
  "/team",
  "/settings",
  "/usage",
  "/testing",
  "/admin",
  "/overages",
  "/overview",
  "/help",
  "/support",
];

// Routes only accessible by platform admins
const adminRoutes = ["/admin"];

// Public routes that authenticated users shouldn't access
const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

// Routes that need to be accessible during 2FA flow (user has session but hasn't completed 2FA)
const twoFactorRoutes = ["/login/2fa"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // Skip middleware for static files and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // NOTE: RSC prefetch requests cannot be detected here because Vercel's edge
  // network strips query parameters before the middleware receives the request.
  // Safari's ITP blocks these prefetch requests client-side anyway.
  // Solution: Disable prefetch on Link components (prefetch={false})

  // IMPORTANT: Skip Supabase session handling for OAuth callback
  // The callback page handles the code exchange manually
  // Running updateSession here would consume the OAuth code before the page can use it
  if (pathname === "/callback") {
    return NextResponse.next();
  }

  // Check if we're on the dashboard subdomain
  const isDashboardSubdomain = hostname.startsWith("dashboard.") ||
    hostname.includes("localhost") ||
    hostname.includes("vercel.app");

  // Check for custom email/password auth (stored in cookie)
  const customAuthToken = request.cookies.get("plexmcp_auth_token")?.value;
  const hasCustomAuth = !!customAuthToken;

  // Update Supabase session and get user
  const { user: supabaseUser, supabaseResponse } = await updateSession(request);

  // User is authenticated if they have either Supabase session OR custom auth token
  const user = supabaseUser || (hasCustomAuth ? { id: "custom-auth" } : null);

  // Check if the route requires authentication
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));
  const isTwoFactorRoute = twoFactorRoutes.some((route) => pathname.startsWith(route));
  // Auth routes exclude 2FA routes (2FA routes should be accessible even when user has session)
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route)) && !isTwoFactorRoute;

  // On dashboard subdomain, handle root path specially
  // Root shows dashboard overview if authenticated, redirects to login if not
  if (isDashboardSubdomain && pathname === "/") {
    if (!user) {
      // Unauthenticated user on dashboard subdomain root -> redirect to login
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // Authenticated users see the dashboard overview page
    // Rewrite to /overview which is inside the (dashboard) route group
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    return NextResponse.rewrite(url);
  }

  // Redirect unauthenticated users from protected routes to login
  if (isProtectedRoute && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect authenticated users from auth routes to dashboard
  if (isAuthRoute && user) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const redirectUrl = new URL(redirect || "/", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Check admin access (requires additional query to check is_admin flag)
  // Note: For production, you'd want to cache this or include it in the JWT claims
  if (isAdminRoute && user) {
    // Admin check is done at the page level for now
    // Could be enhanced with custom claims in Supabase JWT
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

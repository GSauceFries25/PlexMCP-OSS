import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

// Get cookie domain for cross-subdomain auth
function getCookieDomain(hostname: string): string | undefined {
  // In production, set cookie domain for subdomain sharing
  if (hostname.endsWith(".plexmcp.com") || hostname === "plexmcp.com") {
    return ".plexmcp.com";
  }
  // In development, don't set domain (use default)
  return undefined;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const cookieDomain = getCookieDomain(request.nextUrl.hostname);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            // Set domain for cross-subdomain auth in production
            const cookieOptions = cookieDomain
              ? { ...options, domain: cookieDomain }
              : options;
            supabaseResponse.cookies.set(name, value, cookieOptions);
          });
        },
      },
    }
  );

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make your application
  // very slow or prone to errors!

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, supabaseResponse };
}

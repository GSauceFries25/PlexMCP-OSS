import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Singleton instance to ensure consistent storage across components
let supabaseInstance: ReturnType<typeof createSupabaseClient<Database>> | null = null;

/**
 * Check if Supabase is configured (environment variables are set)
 * For self-hosted deployments, Supabase OAuth is optional
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Create a Supabase client for browser-side operations
 * Returns null if Supabase is not configured (self-hosted without OAuth)
 */
export function createClient(): ReturnType<typeof createSupabaseClient<Database>> | null {
  // Return null if Supabase is not configured
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (supabaseInstance) {
    return supabaseInstance;
  }

  // Use standard Supabase JS client (NOT @supabase/ssr)
  // This uses localStorage for auth storage, which is more reliable for PKCE
  // @supabase/ssr uses cookies which can fail silently due to SameSite/Secure settings
  supabaseInstance = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Use localStorage for storing auth tokens and PKCE verifier
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
        // Auto refresh tokens
        autoRefreshToken: true,
        // Persist session across tabs
        persistSession: true,
        // IMPORTANT: Disable automatic session detection from URL
        // This was causing "invalid flow state" errors because the client
        // was auto-exchanging before our manual handler could run
        // See DEBUG_OAUTH.md Attempt 12 for details
        detectSessionInUrl: false,
        // Use PKCE flow (default)
        flowType: "pkce",
      },
    }
  );

  return supabaseInstance;
}

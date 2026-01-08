"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiClient } from "@/lib/api/client";
import { setSigningOut as setGlobalSigningOut } from "@/lib/signing-out";
import { initCsrfProtection, clearCsrfToken } from "@/lib/csrf-client";
import type { User } from "@supabase/supabase-js";
import type { Organization } from "@/types/database";

// API URL for 2FA checks
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Session storage key for 2FA completion
const TWO_FA_COMPLETED_KEY = "plexmcp_2fa_completed";

// localStorage key for non-sensitive user data (UI purposes only)
// SOC 2 CC6.1: Auth tokens are stored in HttpOnly cookies only
const CUSTOM_USER_KEY = "plexmcp_user";

// Helper to get cached user data from localStorage (non-auth, UI purposes only)
// Auth tokens are now stored exclusively in HttpOnly cookies
function getCustomUserData(): { user: unknown } {
  if (typeof window === "undefined") return { user: null };
  try {
    const userStr = localStorage.getItem(CUSTOM_USER_KEY);
    const user = userStr ? JSON.parse(userStr) : null;
    return { user };
  } catch {
    return { user: null };
  }
}

// Helper to clear user data and HttpOnly auth cookies
// SOC 2 CC6.1: Properly clear HttpOnly cookies via API route
function clearCustomUserData(): void {
  if (typeof window === "undefined") return;
  try {
    // Only clear non-sensitive user data from localStorage
    localStorage.removeItem(CUSTOM_USER_KEY);
    // Clear HttpOnly cookies via API route (cannot be cleared via JavaScript)
    fetch("/api/auth/set-cookie", {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {
      // Ignore errors during cookie clearing
    });
  } catch {
    // Ignore storage errors
  }
}

// Helper to check if 2FA was completed for a user in this session
function is2FACompletedForUser(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = sessionStorage.getItem(TWO_FA_COMPLETED_KEY);
    if (!stored) return false;
    const data = JSON.parse(stored);
    return data.userId === userId;
  } catch {
    return false;
  }
}

// Helper to mark 2FA as completed for a user in this session
function set2FACompletedForUser(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TWO_FA_COMPLETED_KEY, JSON.stringify({ userId }));
  } catch {
    // Ignore storage errors
  }
}

// Helper to clear 2FA completion status
function clear2FACompleted(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TWO_FA_COMPLETED_KEY);
  } catch {
    // Ignore storage errors
  }
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  accessToken: string | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  organizationsLoading: boolean;
  requires2FA: boolean;
  isSigningOut: boolean;
  /** Returns true if sign out is in progress (synchronous ref check) */
  isSigningOutSync: () => boolean;
  setCurrentOrganization: (org: Organization) => void;
  refreshOrganizations: () => Promise<void>;
  signOut: () => Promise<void>;
  mark2FAComplete: (userId: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  accessToken: null,
  organizations: [],
  currentOrganization: null,
  organizationsLoading: true,
  requires2FA: false,
  isSigningOut: false,
  isSigningOutSync: () => false,
  setCurrentOrganization: () => {},
  refreshOrganizations: async () => {},
  signOut: async () => {},
  mark2FAComplete: () => {},
});

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Helper hook to get the current organization ID
export function useOrganizationId() {
  const { currentOrganization } = useAuth();
  return currentOrganization?.id ?? "";
}

interface AuthProviderProps {
  children: ReactNode;
}

// Wrapper to bypass AuthProvider completely on callback page
// This prevents ANY Supabase client creation which would consume the OAuth code
export function AuthProvider({ children }: AuthProviderProps) {
  const pathname = usePathname();

  // On callback page, render children directly WITHOUT any Supabase client
  // This is critical - even creating a Supabase client can trigger OAuth code exchange
  if (pathname === "/callback") {
    return <>{children}</>;
  }

  return <AuthProviderInner>{children}</AuthProviderInner>;
}

function AuthProviderInner({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrganization, setCurrentOrganizationState] = useState<Organization | null>(null);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [requires2FA, setRequires2FA] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const twoFACheckedRef = useRef<string | null>(null);
  const twoFACheckInProgressRef = useRef<boolean>(false); // Lock to prevent concurrent checks
  const pathnameRef = useRef<string | null>(null); // Track pathname in ref to avoid stale closure issues
  const mountedRef = useRef<boolean>(false); // Track if initial session was processed - NEVER reset this
  const userRef = useRef<User | null>(null); // Track current user for SIGNED_OUT check
  const lastEventRef = useRef<{ event: string; time: number }>({ event: "", time: 0 }); // Debounce
  const signingOutRef = useRef<boolean>(false); // Prevent TOKEN_REFRESHED from restoring user during sign out
  // CRITICAL: Memoize Supabase client to prevent recreation on every render
  // Creating a new client on each render causes infinite auth state change loops
  // Note: supabase may be null if Supabase is not configured (self-hosted without OAuth)
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();

  // Keep pathnameRef in sync
  pathnameRef.current = pathname;

  // Check if 2FA is required for this user (used for OAuth logins)
  const check2FARequired = useCallback(async (token: string, userId: string): Promise<{
    required: boolean;
    tempToken?: string;
    alreadyOn2FAPage?: boolean;
  }> => {
    // If already on 2FA page, signal that 2FA is in progress
    if (pathnameRef.current?.startsWith("/login/2fa")) {
      return { required: false, alreadyOn2FAPage: true };
    }

    // Prevent concurrent 2FA checks
    if (twoFACheckInProgressRef.current) {
      return { required: false };
    }

    // Check sessionStorage first (persists across page refreshes)
    if (is2FACompletedForUser(userId)) {
      twoFACheckedRef.current = userId;
      return { required: false };
    }

    // Don't re-check for the same user ID in this session (memory cache)
    if (twoFACheckedRef.current === userId) {
      return { required: false };
    }

    // NOTE: Previously had an isProtectedPage check that skipped 2FA if user was on
    // a protected page. This was incorrect because OAuth redirects users to protected
    // pages BEFORE 2FA can be checked. The sessionStorage check above is sufficient
    // to prevent re-prompting on page refreshes for users who have completed 2FA.

    // Set lock to prevent concurrent checks
    twoFACheckInProgressRef.current = true;

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/check-2fa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        twoFACheckedRef.current = userId;

        // Treat both 2fa_required and 2fa_pending as requiring 2FA
        if (data.status === "2fa_required" || data.status === "2fa_pending") {
          return { required: true, tempToken: data.temp_token };
        }
      }
    } catch (err) {
      console.error("[AuthProvider] 2FA check error:", err);
    } finally {
      twoFACheckInProgressRef.current = false;
    }

    // Mark as checked even on error (don't block user)
    twoFACheckedRef.current = userId;
    return { required: false };
  }, []); // No dependencies - uses refs for current values

  // Track if we've already fetched orgs for this session
  const orgsFetchedRef = useRef<boolean>(false);

  // Fetch organizations from the backend API
  const fetchOrganizations = useCallback(async (token: string, force = false) => {
    // CRITICAL: Don't fetch during sign out - this can clear org state without clearing user state
    if (signingOutRef.current) {
      return;
    }

    // Skip if we already fetched orgs and not forcing refresh
    if (orgsFetchedRef.current && !force) {
      return;
    }
    setOrganizationsLoading(true);
    try {
      apiClient.setAccessToken(token);
      const response = await apiClient.getOrganizations();

      if (response.error) {
        console.error("Failed to fetch organizations:", response.error);
        // Don't clear org state if we're signing out
        if (!signingOutRef.current) {
          setOrganizations([]);
        }
        return;
      }

      const orgs = response.data || [];
      setOrganizations(orgs);

      // Handle organization selection
      const savedOrgId = localStorage.getItem("currentOrganizationId");

      if (orgs.length > 0) {
        const savedOrg = orgs.find((o: Organization) => o.id === savedOrgId);
        if (savedOrg) {
          setCurrentOrganizationState(savedOrg);
        } else {
          if (savedOrgId) localStorage.removeItem("currentOrganizationId");
          setCurrentOrganizationState(orgs[0]);
          localStorage.setItem("currentOrganizationId", orgs[0].id);
        }
      } else {
        if (savedOrgId) localStorage.removeItem("currentOrganizationId");
        // Don't clear org state if we're signing out
        if (!signingOutRef.current) {
          setCurrentOrganizationState(null);
        }
      }
      // Mark as fetched
      orgsFetchedRef.current = true;
    } catch (error) {
      console.error("Error fetching organizations:", error);
      // Don't clear org state if we're signing out - this prevents the "No Organization" flash
      if (!signingOutRef.current) {
        setOrganizations([]);
        localStorage.removeItem("currentOrganizationId");
        setCurrentOrganizationState(null);
      }
    } finally {
      setOrganizationsLoading(false);
    }
  }, []);

  // Set current organization and persist to localStorage
  const setCurrentOrganization = useCallback((org: Organization) => {
    setCurrentOrganizationState(org);
    localStorage.setItem("currentOrganizationId", org.id);
  }, []);

  // Refresh organizations (force refetch)
  const refreshOrganizations = useCallback(async () => {
    if (accessToken) {
      await fetchOrganizations(accessToken, true); // Force refresh
    }
  }, [accessToken, fetchOrganizations]);

  // Fetch user profile from backend to get platform_role and is_admin fields
  // This is needed for OAuth users since Supabase User object doesn't include custom fields
  const enrichUserWithProfile = useCallback(async (supabaseUser: User, token: string): Promise<User> => {
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/me`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const profile = await response.json();

        // Merge platform_role and is_admin into the Supabase user object
        return {
          ...supabaseUser,
          is_admin: profile.is_admin,
          platform_role: profile.platform_role,
        } as unknown as User;
      }
    } catch (err) {
      console.error("[AuthProvider] Failed to fetch user profile:", err);
    }

    // Return original user if fetch fails
    return supabaseUser;
  }, []);

  // Mark 2FA as complete for a user (called after successful 2FA verification)
  const mark2FAComplete = useCallback((userId: string) => {
    twoFACheckedRef.current = userId;
    set2FACompletedForUser(userId);
    setRequires2FA(false);
    if (accessToken) {
      fetchOrganizations(accessToken);
    }
  }, [accessToken, fetchOrganizations]);

  // Synchronous check for signing out state - reads ref directly
  // This is critical for preventing "No Organization Found" flash during sign out
  const isSigningOutSync = useCallback(() => {
    return signingOutRef.current;
  }, []);

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    let cancelled = false;

    // Get initial session - this runs once on mount
    // Note: Callback page is completely excluded from AuthProviderInner via the wrapper
    const getInitialSession = async () => {
      if (cancelled) return;

      // Initialize CSRF protection (SOC 2 CC6.1)
      initCsrfProtection().catch(err => {
        console.warn("[AuthProvider] Failed to initialize CSRF protection:", err);
      });

      // Reset signing out flags - we're starting fresh
      setGlobalSigningOut(false);
      signingOutRef.current = false;

      try {
        // First check for custom email/password auth via HttpOnly cookie
        // SOC 2 CC6.1: Tokens stored in HttpOnly cookies, not localStorage
        const cachedUserData = getCustomUserData();

        if (cachedUserData.user) {
          // User data exists - validate session via HttpOnly cookie
          // The cookie is sent automatically to our Next.js API route
          try {
            const validateResponse = await fetch("/api/auth/validate-session", {
              method: "POST",
              credentials: "include", // Send HttpOnly cookie
            });

            if (!validateResponse.ok) {
              clearCustomUserData();
              // Fall through to Supabase session check below
            } else {
              const sessionData = await validateResponse.json();

              // Create a minimal User-like object from the validated user data
              const customUser = sessionData.user as {
                id: string;
                email: string;
                role: string;
                org_id: string;
                is_admin?: boolean;
                platform_role?: string;
              };
              const mockUser = {
                id: customUser.id,
                email: customUser.email,
                // Add minimal required fields for User type
                aud: "authenticated",
                role: customUser.role,
                created_at: "",
                updated_at: "",
                app_metadata: {},
                user_metadata: {
                  role: customUser.role,
                  org_id: customUser.org_id,
                },
                // Include admin fields at root level for app-sidebar.tsx
                is_admin: customUser.is_admin,
                platform_role: customUser.platform_role,
              } as unknown as User;

              setUser(mockUser);
              userRef.current = mockUser;
              setAccessToken(sessionData.access_token);
              apiClient.setAccessToken(sessionData.access_token);

              // No 2FA check needed - already completed during login
              setRequires2FA(false);
              await fetchOrganizations(sessionData.access_token);

              mountedRef.current = true;
              setLoading(false);
              return;
            }
          } catch (err) {
            console.error("[AuthProvider] Error validating session cookie:", err);
            clearCustomUserData();
            // Fall through to Supabase session check below
          }
        }

        // Otherwise check for Supabase session (OAuth logins)
        // Skip if Supabase is not configured (self-hosted without OAuth)
        if (supabase) {
          // Add timeout to prevent infinite hang
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 5000);
          });

          const sessionPromise = supabase.auth.getSession().then(res => res.data.session);
          const session = await Promise.race([sessionPromise, timeoutPromise]);

          if (cancelled) return;

          if (session?.access_token && session?.user) {
            // Enrich OAuth user with platform_role and is_admin from backend
            const enrichedUser = await enrichUserWithProfile(session.user, session.access_token);

            setUser(enrichedUser);
            userRef.current = enrichedUser; // Keep ref in sync
            setAccessToken(session.access_token);
            apiClient.setAccessToken(session.access_token);

            // Check 2FA for initial session
            const twoFAResult = await check2FARequired(session.access_token, session.user.id);

            if (twoFAResult.required && twoFAResult.tempToken) {
              setRequires2FA(true);
              const currentPath = window.location.pathname;
              const redirectPath = currentPath === "/login" ? "/" : currentPath;
              router.push(`/login/2fa?temp_token=${encodeURIComponent(twoFAResult.tempToken)}&user_id=${encodeURIComponent(session.user.id)}&redirect=${encodeURIComponent(redirectPath)}&oauth=true`);
            } else {
              setRequires2FA(false);
              await fetchOrganizations(session.access_token);
            }
          } else {
            setOrganizationsLoading(false);
          }
        } else {
          // Supabase not configured - only email/password auth is available
          setOrganizationsLoading(false);
        }

        // Mark as mounted - NEVER reset this during component lifecycle
        mountedRef.current = true;
        setLoading(false);
      } catch (error) {
        console.error("[AuthProvider] Error in getInitialSession:", error);
        setOrganizationsLoading(false);
        setLoading(false);
        mountedRef.current = true;
      }
    };

    getInitialSession();

    // Listen for auth changes - but skip events until initial session is processed
    // Only subscribe if Supabase is configured (supabase may be null for self-hosted without OAuth)
    let subscription: { unsubscribe: () => void } | null = null;

    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Skip ALL auth events until initial session is processed
      if (!mountedRef.current) {
        return;
      }

      // Debounce: skip if same event fired within 500ms
      const now = Date.now();
      if (event === lastEventRef.current.event && now - lastEventRef.current.time < 500) {
        return;
      }
      lastEventRef.current = { event, time: now };

      // For TOKEN_REFRESHED, update token and set user if we don't have one
      if (event === "TOKEN_REFRESHED" && session?.access_token && session?.user) {
        // Skip if we're in the process of signing out
        if (signingOutRef.current) {
          return;
        }

        // Log token refresh for audit trail (SOC 2 compliance)
        fetch(`${API_URL}/api/v1/audit/session-event`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            event_name: "token_refreshed",
            session_id: session.access_token.substring(0, 16),
          }),
        }).catch(err => console.error("[Audit] Failed to log token refresh:", err));

        // If we don't have a user yet, set it now (handles timeout case)
        if (!userRef.current) {
          // Enrich OAuth user with platform_role and is_admin from backend
          const enrichedUser = await enrichUserWithProfile(session.user, session.access_token);

          setUser(enrichedUser);
          userRef.current = enrichedUser;
          setAccessToken(session.access_token);
          apiClient.setAccessToken(session.access_token);

          // Check 2FA requirement
          const twoFAResult = await check2FARequired(session.access_token, session.user.id);

          if (twoFAResult.required && twoFAResult.tempToken) {
            setRequires2FA(true);
            const currentPath = window.location.pathname;
            const redirectPath = currentPath === "/login" ? "/" : currentPath;
            router.push(`/login/2fa?temp_token=${encodeURIComponent(twoFAResult.tempToken)}&user_id=${encodeURIComponent(session.user.id)}&redirect=${encodeURIComponent(redirectPath)}&oauth=true`);
            setLoading(false);
            return;
          }

          setRequires2FA(false);
          fetchOrganizations(session.access_token);
        }
        return;
      }

      // Handle actual sign in events
      if (event === "SIGNED_IN" && session?.access_token && session?.user) {
        // Log session establishment for audit trail (SOC 2 compliance)
        fetch(`${API_URL}/api/v1/audit/session-event`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            event_name: "signed_in",
            session_id: session.access_token.substring(0, 16),
          }),
        }).catch(err => console.error("[Audit] Failed to log session establishment:", err));

        // Enrich OAuth user with platform_role and is_admin from backend
        const enrichedUser = await enrichUserWithProfile(session.user, session.access_token);

        setUser(enrichedUser);
        userRef.current = enrichedUser; // Keep ref in sync
        setAccessToken(session.access_token);
        apiClient.setAccessToken(session.access_token);

        const twoFAResult = await check2FARequired(session.access_token, session.user.id);

        if (twoFAResult.alreadyOn2FAPage) {
          setRequires2FA(true);
          setLoading(false);
          return;
        }

        if (twoFAResult.required && twoFAResult.tempToken) {
          setRequires2FA(true);
          const currentPath = window.location.pathname;
          const redirectPath = currentPath === "/login" ? "/" : currentPath;
          router.push(`/login/2fa?temp_token=${encodeURIComponent(twoFAResult.tempToken)}&user_id=${encodeURIComponent(session.user.id)}&redirect=${encodeURIComponent(redirectPath)}&oauth=true`);
          setLoading(false);
          return;
        }

        setRequires2FA(false);
        await fetchOrganizations(session.access_token, true); // Force fetch on new sign in
        setLoading(false);
        return;
      }

      // Handle sign out - ONLY process if explicitly triggered by user
      // Ignore SIGNED_OUT events that come alongside TOKEN_REFRESHED (session is actually valid)
      if (event === "SIGNED_OUT" && !session) {
        // Skip if we don't have a user (nothing to sign out)
        if (!userRef.current) {
          return;
        }

        const on2FAPage = pathnameRef.current?.startsWith("/login/2fa");
        const preserveState = on2FAPage || twoFACheckInProgressRef.current;

        if (preserveState) {
          return;
        }

        // Wait a short moment to see if TOKEN_REFRESHED follows
        // If it does, this SIGNED_OUT is spurious
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if we still have a user after the delay
        // (TOKEN_REFRESHED would have set it back)
        if (userRef.current) {
          return; // User was restored by TOKEN_REFRESHED, ignore this SIGNED_OUT
        }

        // Genuine sign out - clear user state
        setUser(null);
        setAccessToken(null);
        apiClient.setAccessToken(null);
        setOrganizations([]);
        setCurrentOrganizationState(null);
        setOrganizationsLoading(false);
        setRequires2FA(false);
        twoFACheckedRef.current = null;
        orgsFetchedRef.current = false;
        clear2FACompleted();
        setLoading(false);
      }
      });
      subscription = data.subscription;
    }

    return () => {
      cancelled = true;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [supabase, fetchOrganizations, check2FARequired, enrichUserWithProfile, router]);

  const signOut = async () => {
    // Log logout for audit trail (SOC 2 compliance) - do this BEFORE clearing state
    if (accessToken) {
      fetch(`${API_URL}/api/v1/audit/session-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          event_name: "logout",
        }),
      }).catch(err => console.error("[Audit] Failed to log logout:", err));
    }

    // Set GLOBAL flag FIRST - this is readable by ANY component without React context
    setGlobalSigningOut(true);
    // Also set ref for internal use
    signingOutRef.current = true;

    // Clear tracking refs
    twoFACheckedRef.current = null;
    twoFACheckInProgressRef.current = false;
    orgsFetchedRef.current = false;
    userRef.current = null;

    // CRITICAL: Use flushSync to force IMMEDIATE state update
    // This ensures the loading overlay is shown BEFORE any other code can run
    // Without flushSync, React batches updates and children might re-render with stale state
    flushSync(() => {
      setIsSigningOut(true);
      setUser(null);
      setAccessToken(null);
      setOrganizations([]);
      setCurrentOrganizationState(null);
      setRequires2FA(false);
    });

    // Clear other state (not wrapped in flushSync as they don't affect React rendering)
    clear2FACompleted();
    clearCustomUserData();  // Clear user data and HttpOnly auth cookies
    clearCsrfToken();  // Clear CSRF token (SOC 2 CC6.1)
    apiClient.setAccessToken(null);
    localStorage.removeItem("currentOrganizationId");

    // Call server-side logout to properly clear all cookies (including Supabase with correct domain)
    // This is more reliable than client-side supabase.auth.signOut() for cross-subdomain cookies
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("[AuthProvider] Server-side logout error:", error);
    }

    // Also do the client-side Supabase sign out for completeness
    // Only if Supabase is configured (may be null for self-hosted without OAuth)
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (error) {
        // Even if Supabase sign out fails, we've already cleared local state
        // This is intentional - we want to ensure the user can't see stale data
        console.error("[AuthProvider] signOut error (state already cleared):", error);
      }
    }

    // Redirect to login page after sign out
    router.push("/login");

    // Reset the signing out flags after a short delay to allow navigation to complete
    // This prevents the overlay from blocking indefinitely if navigation is slow
    setTimeout(() => {
      signingOutRef.current = false;
      setGlobalSigningOut(false);
      setIsSigningOut(false);
    }, 500);
  };

  // CRITICAL: Use ref-based derived values to ensure synchronous consistency during sign out
  // The signingOutRef is set synchronously at the start of signOut(), but state updates are async.
  // By checking signingOutRef here, we guarantee that components see consistent values immediately.
  const effectiveUser = signingOutRef.current ? null : user;
  const effectiveCurrentOrganization = signingOutRef.current ? null : currentOrganization;
  const effectiveIsSigningOut = signingOutRef.current ? true : isSigningOut;
  const effectiveOrganizations = signingOutRef.current ? [] : organizations;

  const contextValue = {
    user: effectiveUser,
    loading,
    accessToken: signingOutRef.current ? null : accessToken,
    organizations: effectiveOrganizations,
    currentOrganization: effectiveCurrentOrganization,
    organizationsLoading: signingOutRef.current ? false : organizationsLoading,
    requires2FA: signingOutRef.current ? false : requires2FA,
    isSigningOut: effectiveIsSigningOut,
    isSigningOutSync,
    setCurrentOrganization,
    refreshOrganizations,
    signOut,
    mark2FAComplete,
  };

  // Block children rendering during sign out
  // This is the most reliable way to prevent "No Organization Found" flash
  // because we check signingOutRef.current at RENDER TIME in the provider itself
  if (signingOutRef.current) {
    return (
      <AuthContext.Provider value={contextValue}>
        <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Signing out...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

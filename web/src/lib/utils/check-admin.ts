import type { User } from "@supabase/supabase-js";

/**
 * Check if a user has admin privileges
 * Supports both custom email/password auth and OAuth auth
 */
export function isUserAdmin(user: User | null): boolean {
  if (!user) return false;

  // Check custom auth tokens first (email/password login)
  if (typeof window !== "undefined") {
    try {
      const customUser = localStorage.getItem("plexmcp_user");
      if (customUser) {
        const parsed = JSON.parse(customUser);
        return ["admin", "superadmin", "staff"].includes(parsed.platform_role || parsed.role);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check OAuth users (enriched with platform_role from backend)
  const platformRole = (user as any)?.platform_role;
  const isAdminFlag = (user as any)?.is_admin;

  if (platformRole && ["admin", "superadmin", "staff"].includes(platformRole)) {
    return true;
  }

  if (isAdminFlag === true) {
    return true;
  }

  // Legacy fallback to user_metadata
  return user?.user_metadata?.role === "admin";
}

/**
 * Check if a user has superadmin privileges
 */
export function isUserSuperadmin(user: User | null): boolean {
  if (!user) return false;

  // Check custom auth tokens first
  if (typeof window !== "undefined") {
    try {
      const customUser = localStorage.getItem("plexmcp_user");
      if (customUser) {
        const parsed = JSON.parse(customUser);
        return parsed.platform_role === "superadmin";
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check OAuth users
  const platformRole = (user as any)?.platform_role;
  return platformRole === "superadmin";
}

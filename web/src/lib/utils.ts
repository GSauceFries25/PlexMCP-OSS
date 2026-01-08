import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Validates and sanitizes a redirect URL to prevent open redirect attacks.
 * Only allows relative paths starting with "/" (not "//" which is protocol-relative).
 * Returns "/" as the safe default if the URL is invalid.
 *
 * SOC 2 CC6.1: Prevents open redirect attacks including URL-encoded bypasses
 *
 * @param url - The redirect URL to validate
 * @returns A safe redirect path
 */
export function getSafeRedirectUrl(url: string | null | undefined): string {
  // Default to "/" if no URL provided
  if (!url) {
    return "/";
  }

  // Decode URL to catch encoded bypass attempts (e.g., %2F%2F for //)
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.trim());
  } catch {
    // Invalid URL encoding - reject
    return "/";
  }

  // Normalize backslashes (Windows-style paths that browsers may interpret as //)
  decoded = decoded.replace(/\\/g, "/");

  // Must start with exactly one forward slash (relative path)
  // Reject: empty, "//evil.com", "https://evil.com", "javascript:", etc.
  if (!decoded.startsWith("/") || decoded.startsWith("//")) {
    return "/";
  }

  // Reject protocol-relative URLs
  if (decoded.includes("://")) {
    return "/";
  }

  // Check for javascript: protocol (case-insensitive)
  if (decoded.toLowerCase().includes("javascript:")) {
    return "/";
  }

  // Check for data: protocol (case-insensitive)
  if (decoded.toLowerCase().includes("data:")) {
    return "/";
  }

  return decoded;
}

import { z } from "zod";

/**
 * Email validation matching backend RFC 5322 (simplified) implementation
 * SOC 2 CC6.1: Strong input validation for authentication
 *
 * Backend reference: crates/api/src/routes/auth.rs:1941-2002
 */

/**
 * Validates email address according to RFC 5322 (simplified)
 * Matches backend is_valid_email() function exactly
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();

  // Length checks per RFC 5321
  if (trimmed.length > 254 || trimmed.length === 0) {
    return false;
  }

  const parts = trimmed.split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;

  // Local part validation
  if (local.length === 0 || local.length > 64) {
    return false;
  }
  // No leading/trailing/consecutive dots
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  // Allow alphanumeric, dots, hyphens, underscores, plus signs
  if (!/^[a-zA-Z0-9.+_-]+$/.test(local)) {
    return false;
  }

  // Domain validation
  if (domain.length === 0 || domain.length > 255) {
    return false;
  }
  // No leading/trailing hyphens
  if (domain.startsWith("-") || domain.endsWith("-")) {
    return false;
  }
  // No leading/trailing/consecutive dots
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }

  // Must have valid TLD (at least 2 chars, alpha only)
  const domainParts = domain.split(".");
  if (domainParts.length < 2) {
    return false;
  }
  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
    return false;
  }

  // Domain characters: alphanumeric, dots, hyphens only
  if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
    return false;
  }

  return true;
}

/**
 * Zod email schema that matches backend validation
 * Use this instead of z.string().email() for consistency
 */
export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .max(254, "Email must be less than 254 characters")
  .refine(isValidEmail, {
    message: "Please enter a valid email address",
  });

/**
 * Password validation matching backend requirements
 * SOC 2 CC6.1: Strong password policy
 *
 * Requirements:
 * - Minimum 12 characters
 * - Maximum 128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`])/,
    "Password must contain uppercase, lowercase, number, and special character (!@#$%^&*)"
  );

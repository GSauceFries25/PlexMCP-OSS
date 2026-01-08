/**
 * Centralized date utility functions for the application
 *
 * All date parsing and formatting should use these utilities to ensure
 * consistent behavior across the application.
 */

import { parseISO, isValid, format, formatDistanceToNow } from 'date-fns';

/**
 * Safely parse a date value from the API
 *
 * API returns ISO 8601 timestamps in TIMESTAMPTZ format from PostgreSQL
 * (e.g., "2024-12-25T14:30:45.123Z")
 *
 * @param dateValue - Date string, Date object, null, or undefined
 * @returns Parsed Date object or null if invalid
 */
export function safeParseDate(dateValue: string | Date | null | undefined): Date | null {
  if (!dateValue) return null;

  try {
    // If already a Date object, validate it
    if (dateValue instanceof Date) {
      return isValid(dateValue) ? dateValue : null;
    }

    // Parse ISO 8601 string from API
    const date = parseISO(dateValue);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Format a date with a custom format string
 *
 * Returns "Unknown" if the date cannot be parsed
 *
 * @param dateValue - Date to format
 * @param formatStr - Format string (see date-fns format documentation)
 * @returns Formatted date string or "Unknown"
 *
 * @example
 * safeFormatDate(message.created_at, "MMM d, yyyy 'at' h:mm a")
 * // => "Dec 25, 2025 at 2:45 PM"
 */
export function safeFormatDate(
  dateValue: string | Date | null | undefined,
  formatStr: string
): string {
  const date = safeParseDate(dateValue);
  if (!date) return "Unknown";

  try {
    return format(date, formatStr);
  } catch {
    return "Unknown";
  }
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 *
 * Returns "Unknown" if the date cannot be parsed
 *
 * @param dateValue - Date to format
 * @returns Relative time string or "Unknown"
 *
 * @example
 * safeFormatDistanceToNow(ticket.created_at)
 * // => "5 hours ago"
 */
export function safeFormatDistanceToNow(
  dateValue: string | Date | null | undefined
): string {
  const date = safeParseDate(dateValue);
  if (!date) return "Unknown";

  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

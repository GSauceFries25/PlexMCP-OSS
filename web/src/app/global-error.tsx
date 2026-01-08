"use client";

import { useEffect } from "react";

// Safely convert any value to a displayable string
function safeString(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || value.name || "Unknown error";
  try {
    return JSON.stringify(value);
  } catch {
    return "[Object]";
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Safely extract error properties
  const errorName = safeString(error?.name) || "Error";
  const errorMessage = safeString(error?.message) || "An unexpected error occurred";
  const errorDigest = error?.digest ? safeString(error.digest) : null;

  useEffect(() => {
    console.error("Global error:", error);
    console.error("Error name:", errorName);
    console.error("Error message:", errorMessage);
  }, [error, errorName, errorMessage]);

  return (
    <html>
      <body className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20 mb-6">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Application Error
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Something went wrong. Please try again or contact support if the problem persists.
          </p>
          {process.env.NODE_ENV === "development" && (
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-left mb-6 overflow-auto max-h-48">
              <p className="text-red-600 dark:text-red-400 font-mono text-sm break-words">
                {errorName}: {errorMessage}
              </p>
              {errorDigest && (
                <p className="text-gray-500 font-mono text-xs mt-2">Digest: {errorDigest}</p>
              )}
            </div>
          )}
          <div className="flex gap-4 justify-center">
            <button
              onClick={reset}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
            <a
              href="/"
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

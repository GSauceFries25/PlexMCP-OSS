"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import Link from "next/link";

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

export default function DashboardError({
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
    // Log the error to console for debugging
    console.error("Dashboard error:", error);
    console.error("Error name:", errorName);
    console.error("Error message:", errorMessage);
    console.error("Error stack:", error?.stack);
  }, [error, errorName, errorMessage]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20 mb-4">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            An error occurred while loading this page. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {process.env.NODE_ENV === "development" && (
            <div className="p-3 bg-muted rounded-md text-xs font-mono overflow-auto max-h-32">
              <p className="text-red-600 dark:text-red-400 font-semibold">{errorName}: {errorMessage}</p>
              {errorDigest && (
                <p className="text-muted-foreground mt-1">Digest: {errorDigest}</p>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <Button onClick={reset} className="flex-1">
              <RefreshCcw className="h-4 w-4 mr-2" />
              Try again
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <Link href="/">
                <Home className="h-4 w-4 mr-2" />
                Go home
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

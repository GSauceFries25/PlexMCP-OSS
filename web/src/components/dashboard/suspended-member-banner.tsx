"use client";

import { AlertTriangle, HelpCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface SuspendedMemberBannerProps {
  organizationName?: string;
}

/**
 * Banner displayed to suspended members who have read-only access
 * due to organization plan limits after a downgrade.
 */
export function SuspendedMemberBanner({
  organizationName = "your organization",
}: SuspendedMemberBannerProps) {
  return (
    <Alert className="border-amber-500 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">
        Read-Only Access
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
          <span>
            Your account has been set to read-only due to {organizationName}&apos;s plan limits.
            You can view MCPs, analytics, and other resources, but cannot create or modify anything.
          </span>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/50 w-fit shrink-0"
          >
            <Link href="/help/suspended-access">
              <HelpCircle className="mr-2 h-4 w-4" />
              Learn More
            </Link>
          </Button>
        </div>
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
          Contact your organization owner to restore full access.
        </p>
      </AlertDescription>
    </Alert>
  );
}

"use client";

import { TrendingUp, ArrowRight, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useState } from "react";
import { useCurrentOverage } from "@/lib/api/hooks";

interface OverageAlertBannerProps {
  organizationId: string;
  dismissible?: boolean;
  tier?: string;
}

export function OverageAlertBanner({
  organizationId,
  dismissible = true,
  tier,
}: OverageAlertBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const { data: currentOverage, isLoading } = useCurrentOverage(organizationId);

  // Don't show for Free tier users (they can't incur overages - they're hard-blocked)
  if (tier === "free") {
    return null;
  }

  // Don't show if loading, dismissed, or no overage
  if (isLoading || isDismissed) {
    return null;
  }

  const overageCalls = currentOverage?.overage_calls || 0;
  const estimatedChargeCents = currentOverage?.estimated_charge_cents || 0;

  // Don't show if no overage
  if (overageCalls <= 0) {
    return null;
  }

  const amount = (estimatedChargeCents / 100).toFixed(2);

  return (
    <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 relative">
      {dismissible && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 h-6 w-6 text-amber-600 hover:text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-900/50"
          onClick={() => setIsDismissed(true)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      )}
      <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">
        You have outstanding overages
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1 pr-6">
          <span>
            {overageCalls.toLocaleString()} requests over your limit ({" "}
            <span className="font-semibold">${amount}</span>)
          </span>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/50 w-fit"
          >
            <Link href="/overages">
              View Overages
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

"use client";

import { TrendingUp, CreditCard, Clock, DollarSign, Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth, useOrganizationId } from "@/providers/auth-provider";
import { isSigningOut as isGlobalSigningOut } from "@/lib/signing-out";
import {
  useCurrentOverage,
  useSubscription,
  useBillingUsage,
} from "@/lib/api/hooks";
import { CreateOrganizationDialog } from "@/components/dashboard/create-organization-dialog";

// Overage rates by tier
const TIER_RATES: Record<string, number> = {
  pro: 0.50,
  team: 0.25,
};

// Monthly limits by tier
const TIER_LIMITS: Record<string, number> = {
  free: 1000,
  starter: 1000,
  pro: 50000,
  team: 250000,
  enterprise: -1, // unlimited
};

export default function OveragesPage() {
  // Check global signing out flag FIRST - this is synchronous
  const globalSigningOut = isGlobalSigningOut();

  const { currentOrganization, organizationsLoading, isSigningOut, isSigningOutSync, user } = useAuth();
  const signingOutNow = isSigningOutSync();
  const organizationId = useOrganizationId();

  const { data: subscription, isLoading: subscriptionLoading } = useSubscription(organizationId);
  const { data: currentOverage, isLoading: overageLoading } = useCurrentOverage(organizationId);
  const { data: billingUsage, isLoading: usageLoading } = useBillingUsage(organizationId);

  // Only show loading skeleton on INITIAL load (no data yet), not during refetches
  // This prevents OverageHistory from unmounting when user switches tabs during payment
  // Include isSigningOut to prevent "No Organization Found" flash during sign out
  // Use GLOBAL flag for synchronous detection, plus context-based checks
  const isInitialLoading =
    globalSigningOut || isSigningOut || signingOutNow ||
    (organizationsLoading && !currentOrganization) ||
    (subscriptionLoading && !subscription) ||
    (overageLoading && !currentOverage) ||
    (usageLoading && !billingUsage);

  if (isInitialLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  // If user is null, they're signing out or not logged in - show loading
  if (!currentOrganization) {
    if (!user) {
      return (
        <div className="space-y-8">
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <TrendingUp className="h-16 w-16 text-neutral-400" />
        <h2 className="text-xl font-semibold">No Organization Found</h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md">
          You don&apos;t have access to any organizations yet. Create one to get started with PlexMCP.
        </p>
        <CreateOrganizationDialog />
      </div>
    );
  }

  const tier = subscription?.tier || "free";
  const overageRate = TIER_RATES[tier] || 0;
  const monthlyLimit = TIER_LIMITS[tier] || 1000;
  const hasOverageSupport = overageRate > 0;

  // Safely extract numeric values with type guards
  const safeNumber = (val: unknown, fallback = 0): number => {
    if (typeof val === "number" && !isNaN(val)) return val;
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
  };

  const currentUsage = safeNumber(currentOverage?.current_usage ?? billingUsage?.requests_used);
  const overageCalls = safeNumber(currentOverage?.overage_calls);
  const estimatedChargeCents = safeNumber(currentOverage?.estimated_charge_cents);
  const periodEndsAt = currentOverage?.period_ends_at;

  // Calculate days until period ends
  const daysUntilReset = (() => {
    if (!periodEndsAt) return null;
    try {
      const endDate = new Date(String(periodEndsAt));
      if (isNaN(endDate.getTime())) return null;
      return Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    } catch {
      return null;
    }
  })();

  // Show different content based on tier
  if (!hasOverageSupport) {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Overages
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Track and manage usage beyond your plan limits
          </p>
        </div>

        {/* No Overage Support Card */}
        <Card className="border-2 border-dashed">
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <TrendingUp className="h-8 w-8 text-neutral-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  Overage billing not available on {tier === "free" ? "Free" : tier === "enterprise" ? "Enterprise" : "your"} plan
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400 mt-2 max-w-md mx-auto">
                  {tier === "free" ? (
                    <>Upgrade to Pro or Team to enable automatic overage billing when you exceed your monthly limit.</>
                  ) : tier === "enterprise" ? (
                    <>Enterprise plans have unlimited usage. Contact your account manager for custom billing arrangements.</>
                  ) : (
                    <>Your current plan doesn&apos;t support overage billing.</>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current Usage Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Current Usage
            </CardTitle>
            <CardDescription>
              Your API usage this billing period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">
                {currentUsage.toLocaleString()}
              </span>
              <span className="text-neutral-500 dark:text-neutral-400">
                / {monthlyLimit === -1 ? "unlimited" : monthlyLimit.toLocaleString()} requests
              </span>
            </div>
            {daysUntilReset && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
                Resets in {daysUntilReset} day{daysUntilReset !== 1 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Has overage support (Pro/Team tier)
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Overages
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          Track and manage usage beyond your plan limits
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Current Usage */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Usage</CardTitle>
            <Activity className="h-4 w-4 text-neutral-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currentUsage.toLocaleString()}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              of {monthlyLimit.toLocaleString()} included
            </p>
            {currentUsage > monthlyLimit && (
              <Badge variant="outline" className="mt-2 bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
                {overageCalls.toLocaleString()} over limit
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Estimated Overage */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimated Overage</CardTitle>
            <DollarSign className="h-4 w-4 text-neutral-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(estimatedChargeCents / 100).toFixed(2)}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              at ${overageRate.toFixed(2)}/1K requests
            </p>
            {overageCalls > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {Math.ceil(overageCalls / 1000)} batches of 1K calls
              </p>
            )}
          </CardContent>
        </Card>

        {/* Period Info */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Billing Period</CardTitle>
            <Clock className="h-4 w-4 text-neutral-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {daysUntilReset !== null ? `${daysUntilReset} days` : "N/A"}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              until period resets
            </p>
            {periodEndsAt && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {new Date(periodEndsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* How Overage Billing Works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            How Overage Billing Works
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-lg font-bold text-primary">1</span>
              </div>
              <h4 className="font-medium">Automatic Tracking</h4>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Usage beyond your {monthlyLimit.toLocaleString()} monthly limit is tracked automatically in real-time.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-lg font-bold text-primary">2</span>
              </div>
              <h4 className="font-medium">Fair Pricing</h4>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Pay only ${overageRate.toFixed(2)} per 1,000 additional API calls. No surprises.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-lg font-bold text-primary">3</span>
              </div>
              <h4 className="font-medium">Flexible Payment</h4>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Pay now to clear overages early, or wait for automatic billing at period end.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

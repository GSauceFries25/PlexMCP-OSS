"use client";

import { Globe, Check, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DomainPaywallProps {
  tier: string;
  onEnable?: () => void;
  onUpgrade?: () => void;
  isLoading?: boolean;
  priceCents?: number;
}

const features = [
  "Branded URLs for your MCP endpoints",
  "Automatic SSL certificate provisioning",
  "DNS verification and management",
  "Custom subdomain support (mcp.company.com)",
];

export function DomainPaywall({
  tier,
  onEnable,
  onUpgrade,
  isLoading = false,
  priceCents = 1000,
}: DomainPaywallProps) {
  const isFree = tier.toLowerCase() === "free";
  const priceDisplay = `$${(priceCents / 100).toFixed(0)}/month`;

  return (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          <Globe className="h-8 w-8 text-neutral-600 dark:text-neutral-300" />
        </div>
        <CardTitle className="text-xl">Custom Domains</CardTitle>
        <CardDescription className="text-base">
          Use your own domain for MCP endpoints
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-center text-sm text-muted-foreground">
          Connect your own domain (e.g., mcp.yourcompany.com) instead of using
          the default PlexMCP subdomain.
        </p>

        <ul className="space-y-3">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <span className="text-sm text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>

        {isFree ? (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-center">
            <Lock className="h-5 w-5 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Pro or Team plan required
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Upgrade your plan to access Custom Domains
            </p>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-3xl font-bold">{priceDisplay}</div>
            <p className="text-sm text-muted-foreground">billed monthly</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-center pb-6">
        {isFree ? (
          <Button onClick={onUpgrade} className="w-full max-w-xs">
            Upgrade to Pro
          </Button>
        ) : (
          <Button
            onClick={onEnable}
            disabled={isLoading}
            className="w-full max-w-xs"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              "Enable Custom Domains"
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

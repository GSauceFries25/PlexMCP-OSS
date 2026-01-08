"use client";

import { Building2 } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function WelcomeHeader() {
  const { user, currentOrganization, organizationsLoading } = useAuth();

  if (organizationsLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
    );
  }

  const firstName = user?.user_metadata?.full_name?.split(" ")[0] ||
                    user?.email?.split("@")[0] ||
                    "there";

  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome back, {firstName}!
      </h1>
      <div className="flex items-center gap-4 text-muted-foreground">
        {currentOrganization && (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="text-sm">{currentOrganization.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

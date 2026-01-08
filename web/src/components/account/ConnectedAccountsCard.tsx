"use client";

import * as React from "react";
import { useMemo } from "react";
import { Loader2, Link2, Unlink, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { apiClient, type IdentitiesListResponse, type ProviderInfo } from "@/lib/api/client";

// Provider icons
const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path
      fill="currentColor"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="currentColor"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="currentColor"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="currentColor"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path
      fill="currentColor"
      d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
    />
  </svg>
);

const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider.toLowerCase()) {
    case "google":
      return <GoogleIcon />;
    case "github":
      return <GitHubIcon />;
    default:
      return <Link2 className="h-5 w-5" />;
  }
};

interface ConnectedAccountsCardProps {
  className?: string;
}

export function ConnectedAccountsCard({ className }: ConnectedAccountsCardProps) {
  const [isLoading, setIsLoading] = React.useState(true);
  const [data, setData] = React.useState<IdentitiesListResponse | null>(null);
  const [connectingProvider, setConnectingProvider] = React.useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = React.useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<ProviderInfo | null>(null);
  // Memoize Supabase client to prevent recreation on every render
  // Note: supabase may be null if Supabase is not configured (self-hosted without OAuth)
  const supabase = useMemo(() => createClient(), []);
  const oauthEnabled = isSupabaseConfigured() && supabase !== null;

  const fetchIdentities = React.useCallback(async () => {
    // If Supabase is not configured, skip fetching identities
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    try {
      // Get identities from Supabase auth (the source of truth for OAuth)
      // Add timeout to prevent infinite hang
      const timeoutPromise = new Promise<{ data: { user: null } }>((resolve) => {
        setTimeout(() => resolve({ data: { user: null } }), 5000);
      });
      const userPromise = supabase.auth.getUser();
      const { data: { user } } = await Promise.race([userPromise, timeoutPromise]);

      const supabaseIdentities = user?.identities || [];

      // Map Supabase identities to our format
      const connectedProviders = new Set(
        supabaseIdentities.map((i) => i.provider?.toLowerCase())
      );

      // Try to get additional data from our API (like has_password)
      let hasPassword = false;
      try {
        const response = await apiClient.getIdentities();
        if (response.data) {
          hasPassword = response.data.has_password;
        }
      } catch {
        // API might not be available, that's okay - we have Supabase data
        console.log("Could not fetch from API, using Supabase data only");
      }

      // Build the identity list from Supabase data
      const identities = supabaseIdentities.map((i) => ({
        id: i.id,
        provider: i.provider || "",
        email: i.identity_data?.email as string | null || null,
        display_name: (i.identity_data?.full_name || i.identity_data?.name) as string | null || null,
        avatar_url: i.identity_data?.avatar_url as string | null || null,
        linked_at: i.created_at || new Date().toISOString(),
        last_used_at: i.last_sign_in_at || null,
      }));

      // Build available providers list
      const availableProviders: ProviderInfo[] = [
        {
          provider: "google",
          display_name: "Google",
          is_connected: connectedProviders.has("google"),
        },
        {
          provider: "github",
          display_name: "GitHub",
          is_connected: connectedProviders.has("github"),
        },
      ];

      setData({
        identities,
        has_password: hasPassword,
        available_providers: availableProviders,
      });
    } catch (error) {
      console.error("Failed to fetch identities:", error);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    fetchIdentities();
  }, [fetchIdentities]);

  const handleConnect = async (provider: string) => {
    if (!supabase) {
      toast.error("OAuth is not configured for this deployment");
      return;
    }

    setConnectingProvider(provider);

    try {
      // Use Supabase OAuth to connect the provider
      // Use server-side API route for PKCE exchange (has proper cookie access)
      const { error } = await supabase.auth.linkIdentity({
        provider: provider as "google" | "github",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?redirect=${encodeURIComponent("/settings")}`,
        },
      });

      if (error) {
        toast.error(error.message);
      }
    } catch {
      toast.error("Failed to connect account");
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (provider: ProviderInfo) => {
    // Safety check - show warning if this is the only auth method
    if (!data?.has_password && data?.identities.length === 1) {
      toast.error("Cannot disconnect your only sign-in method. Set a password first.");
      return;
    }

    setConfirmDisconnect(provider);
  };

  const confirmDisconnectAction = async () => {
    if (!confirmDisconnect) return;

    if (!supabase) {
      toast.error("OAuth is not configured for this deployment");
      return;
    }

    setDisconnectingProvider(confirmDisconnect.provider);
    setConfirmDisconnect(null);

    try {
      // Try to unlink via Supabase first
      const { error } = await supabase.auth.unlinkIdentity({
        provider: confirmDisconnect.provider as "google" | "github",
      } as Parameters<typeof supabase.auth.unlinkIdentity>[0]);

      if (error) {
        // If Supabase fails, try our backend
        const response = await apiClient.unlinkIdentity(confirmDisconnect.provider);
        if (response.error) {
          toast.error(response.error.message || "Failed to disconnect account");
          return;
        }
      }

      toast.success(`${confirmDisconnect.display_name} account disconnected`);
      fetchIdentities();
    } catch {
      toast.error("Failed to disconnect account");
    } finally {
      setDisconnectingProvider(null);
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>Manage how you sign in to your account</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // If OAuth is not enabled, show a message
  if (!oauthEnabled) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>Manage how you sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            OAuth providers are not configured for this deployment.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Get list of all providers with their status
  const providers: ProviderInfo[] = data?.available_providers || [
    { provider: "google", display_name: "Google", is_connected: false },
    { provider: "github", display_name: "GitHub", is_connected: false },
  ];

  // Match connected identities to providers
  const getIdentityForProvider = (provider: string) => {
    return data?.identities.find((i) => i.provider === provider);
  };

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Manage how you sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers.map((provider) => {
            const identity = getIdentityForProvider(provider.provider);
            const isConnected = provider.is_connected || !!identity;
            const isConnecting = connectingProvider === provider.provider;
            const isDisconnecting = disconnectingProvider === provider.provider;

            return (
              <div
                key={provider.provider}
                className="flex items-center justify-between p-4 rounded-lg border"
              >
                <div className="flex items-center gap-3">
                  <ProviderIcon provider={provider.provider} />
                  <div>
                    <p className="font-medium">{provider.display_name}</p>
                    {isConnected && identity?.email ? (
                      <p className="text-sm text-muted-foreground">
                        {identity.email}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {isConnected ? "Connected" : "Not connected"}
                      </p>
                    )}
                  </div>
                </div>

                {isConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect(provider)}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Unlink className="h-4 w-4 mr-2" />
                        Disconnect
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(provider.provider)}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Link2 className="h-4 w-4 mr-2" />
                        Connect
                      </>
                    )}
                  </Button>
                )}
              </div>
            );
          })}

          {!data?.has_password && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                You don&apos;t have a password set. Consider setting one in case you need to disconnect your connected accounts.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={!!confirmDisconnect} onOpenChange={() => setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirmDisconnect?.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer be able to sign in using your {confirmDisconnect?.display_name} account.
              {!data?.has_password && data?.identities.length === 2 && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                  Warning: You only have one other sign-in method. Make sure you can still access your account.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisconnectAction}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

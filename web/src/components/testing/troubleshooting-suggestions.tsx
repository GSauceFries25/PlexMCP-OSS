"use client";

import { AlertTriangle, ExternalLink, Lightbulb, RefreshCw, Shield, Server, Clock, Link2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TroubleshootingSuggestionsProps {
  errorMessage: string | null;
  healthStatus: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

interface Suggestion {
  title: string;
  description: string;
  icon: typeof AlertTriangle;
  actions?: Array<{
    label: string;
    href?: string;
    onClick?: () => void;
  }>;
}

function matchErrorPattern(errorMessage: string | null): Suggestion | null {
  if (!errorMessage) return null;

  const msg = errorMessage.toLowerCase();

  // Connection refused
  if (msg.includes("connection refused") || msg.includes("econnrefused")) {
    return {
      title: "Connection Refused",
      description: "The MCP server is not responding. This usually means the server is not running or is blocking connections.",
      icon: Server,
      actions: [
        { label: "Check server status", href: "https://docs.plexmcp.com/troubleshooting/connection-refused" },
      ],
    };
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("timed out")) {
    return {
      title: "Connection Timeout",
      description: "The request took too long to complete. This could be due to network issues, firewall rules, or an overloaded server.",
      icon: Clock,
      actions: [
        { label: "Check network", href: "https://docs.plexmcp.com/troubleshooting/timeout" },
      ],
    };
  }

  // DNS resolution
  if (msg.includes("enotfound") || msg.includes("dns") || msg.includes("getaddrinfo")) {
    return {
      title: "DNS Resolution Failed",
      description: "The server hostname could not be resolved. Verify the endpoint URL is correct and the domain exists.",
      icon: Link2,
      actions: [
        { label: "Verify endpoint URL", href: "https://docs.plexmcp.com/troubleshooting/dns" },
      ],
    };
  }

  // SSL/TLS errors
  if (msg.includes("ssl") || msg.includes("tls") || msg.includes("certificate") || msg.includes("cert")) {
    return {
      title: "SSL/TLS Error",
      description: "There's an issue with the server's SSL certificate. This could be an expired, self-signed, or misconfigured certificate.",
      icon: Shield,
      actions: [
        { label: "SSL troubleshooting", href: "https://docs.plexmcp.com/troubleshooting/ssl" },
      ],
    };
  }

  // Authentication errors
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("auth")) {
    return {
      title: "Authentication Failed",
      description: "The server rejected your credentials. Check that your API key or token is correct and hasn't expired.",
      icon: Shield,
      actions: [
        { label: "Update credentials", href: "/mcps" },
      ],
    };
  }

  // Forbidden
  if (msg.includes("403") || msg.includes("forbidden") || msg.includes("access denied")) {
    return {
      title: "Access Forbidden",
      description: "You don't have permission to access this server. Check your API permissions or contact the server administrator.",
      icon: Shield,
    };
  }

  // Not found
  if (msg.includes("404") || msg.includes("not found")) {
    return {
      title: "Endpoint Not Found",
      description: "The MCP endpoint URL doesn't exist. Verify the URL path is correct.",
      icon: Link2,
      actions: [
        { label: "Check endpoint URL", href: "/mcps" },
      ],
    };
  }

  // Server errors
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("internal server error")) {
    return {
      title: "Server Error",
      description: "The MCP server is experiencing internal issues. This is typically a problem on the server side.",
      icon: Server,
    };
  }

  // Invalid JSON/Protocol
  if (msg.includes("json") || msg.includes("parse") || msg.includes("invalid") || msg.includes("malformed")) {
    return {
      title: "Invalid Response",
      description: "The server returned an unexpected response format. Ensure the endpoint is a valid MCP server.",
      icon: AlertTriangle,
    };
  }

  // Generic network error
  if (msg.includes("network") || msg.includes("socket") || msg.includes("econnreset")) {
    return {
      title: "Network Error",
      description: "A network error occurred during the connection. Check your network connectivity and try again.",
      icon: Link2,
    };
  }

  // Fallback
  return {
    title: "Connection Error",
    description: "An error occurred while connecting to the MCP server. Review the error details below and try again.",
    icon: AlertTriangle,
  };
}

export function TroubleshootingSuggestions({
  errorMessage,
  healthStatus,
  onRetry,
  isRetrying,
  className,
}: TroubleshootingSuggestionsProps) {
  if (healthStatus === "healthy" || !errorMessage) {
    return null;
  }

  const suggestion = matchErrorPattern(errorMessage);

  if (!suggestion) return null;

  const Icon = suggestion.icon;

  return (
    <Alert
      variant="destructive"
      className={cn("border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50", className)}
    >
      <Icon className="h-5 w-5" />
      <AlertTitle className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {suggestion.title}
        </span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="h-7 text-xs"
          >
            {isRetrying ? (
              <RefreshCw className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Retry
          </Button>
        )}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p className="text-sm text-red-700 dark:text-red-300">
          {suggestion.description}
        </p>

        <div className="rounded-md bg-red-100 dark:bg-red-900/30 p-3 font-mono text-xs break-all">
          {errorMessage}
        </div>

        {suggestion.actions && suggestion.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestion.actions.map((action, idx) => (
              action.href ? (
                <a
                  key={idx}
                  href={action.href}
                  target={action.href.startsWith("http") ? "_blank" : undefined}
                  rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    {action.label}
                    {action.href.startsWith("http") && (
                      <ExternalLink className="h-3 w-3 ml-1" />
                    )}
                  </Button>
                </a>
              ) : (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              )
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

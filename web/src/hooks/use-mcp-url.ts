"use client";

/**
 * React hook for MCP URL management
 *
 * Provides easy access to the organization's MCP endpoint URL
 * with automatic updates when organization settings change.
 */

import { useMemo } from "react";
import {
  getMcpUrl,
  getAllMcpUrls,
  getMcpHost,
  getDisplaySubdomain,
  type OrganizationForUrl,
  type CustomDomain,
  type McpUrlResult,
} from "@/lib/mcp-url";

export interface UseMcpUrlOptions {
  /** Organization information */
  organization: OrganizationForUrl | null;
  /** Custom domains for the organization */
  customDomains?: CustomDomain[];
}

export interface UseMcpUrlResult {
  /** The primary MCP URL to use */
  mcpUrl: string | null;
  /** All available MCP URLs */
  allUrls: McpUrlResult[];
  /** The host portion of the URL (without protocol) */
  host: string | null;
  /** The subdomain being used */
  subdomain: string | null;
  /** The type of URL being used */
  urlType: McpUrlResult["type"] | null;
  /** Whether data is available */
  isReady: boolean;
}

/**
 * Hook for accessing MCP URL information
 *
 * @example
 * ```tsx
 * const { mcpUrl, subdomain, urlType } = useMcpUrl({
 *   organization: currentOrg,
 *   customDomains: orgDomains,
 * });
 *
 * return (
 *   <div>
 *     <p>Connect to: {mcpUrl}</p>
 *     <p>Your subdomain: {subdomain}</p>
 *   </div>
 * );
 * ```
 */
export function useMcpUrl(options: UseMcpUrlOptions): UseMcpUrlResult {
  const { organization, customDomains = [] } = options;

  return useMemo(() => {
    if (!organization) {
      return {
        mcpUrl: null,
        allUrls: [],
        host: null,
        subdomain: null,
        urlType: null,
        isReady: false,
      };
    }

    const config = { organization, customDomains };
    const primaryUrl = getMcpUrl(config);
    const allUrls = getAllMcpUrls(config);
    const host = getMcpHost(config);
    const subdomain = getDisplaySubdomain(organization);

    return {
      mcpUrl: primaryUrl.url,
      allUrls,
      host,
      subdomain,
      urlType: primaryUrl.type,
      isReady: true,
    };
  }, [organization, customDomains]);
}

/**
 * Simple hook that returns just the MCP URL string
 *
 * @example
 * ```tsx
 * const mcpUrl = useMcpUrlString(organization);
 * ```
 */
export function useMcpUrlString(
  organization: OrganizationForUrl | null,
  customDomains: CustomDomain[] = []
): string | null {
  return useMemo(() => {
    if (!organization) return null;
    return getMcpUrl({ organization, customDomains }).url;
  }, [organization, customDomains]);
}

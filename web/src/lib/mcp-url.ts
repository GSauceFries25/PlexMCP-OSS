/**
 * MCP URL Utility
 *
 * Constructs the correct MCP proxy URL based on organization configuration.
 * Supports:
 * - Auto subdomains (free tier): swift-cloud-742.plexmcp.com/mcp
 * - Custom subdomains (paid): acme.plexmcp.com/mcp
 * - Custom domains ($10/mo addon): mcp.company.com/mcp
 */

import { generateSubdomain } from "./subdomain-generator";

/** Base domain for PlexMCP (without protocol) */
export const BASE_DOMAIN = "plexmcp.com";

/** Full API URL (for legacy/fallback) */
export const LEGACY_API_URL = `https://api.${BASE_DOMAIN}`;

/** Domain status for custom domains */
export type DomainStatus = "pending" | "verifying" | "verified" | "active" | "failed" | "expired";

/** Custom domain information */
export interface CustomDomain {
  id: string;
  domain: string;
  verification_status: DomainStatus;
  ssl_status: DomainStatus;
  is_active?: boolean;
}

/** Organization information needed for URL generation */
export interface OrganizationForUrl {
  id: string;
  slug?: string | null;
  auto_subdomain?: string | null;
  custom_subdomain?: string | null;
  subscription_tier?: string | null;
}

/** Type of MCP URL being used */
export type McpUrlType = "custom_domain" | "custom_subdomain" | "auto_subdomain" | "legacy";

/** Result of MCP URL generation */
export interface McpUrlResult {
  /** The full MCP endpoint URL */
  url: string;
  /** The type of URL being used */
  type: McpUrlType;
  /** Display label for the URL type */
  label: string;
  /** Whether this is the user's preferred/best URL */
  isPrimary: boolean;
}

/** Configuration for MCP URL generation */
export interface McpUrlConfig {
  organization: OrganizationForUrl;
  customDomains?: CustomDomain[];
}

/**
 * Check if a custom domain is fully active (verified + SSL + enabled)
 */
function isCustomDomainActive(domain: CustomDomain): boolean {
  return (
    domain.verification_status === "active" &&
    domain.ssl_status === "active" &&
    domain.is_active !== false
  );
}

/**
 * Check if organization is on a paid tier
 */
function isPaidTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const paidTiers = ["starter", "pro", "team", "enterprise"];
  return paidTiers.includes(tier.toLowerCase());
}

/**
 * Get the best MCP URL for an organization
 *
 * Priority order:
 * 1. Active custom domain (if custom domain addon is active)
 * 2. Custom subdomain (if on paid tier and configured)
 * 3. Auto-generated subdomain (for all users)
 *
 * @param config - Organization and domain configuration
 * @returns The MCP URL result with type information
 */
export function getMcpUrl(config: McpUrlConfig): McpUrlResult {
  const { organization, customDomains = [] } = config;

  // Priority 1: Active custom domain
  const activeCustomDomain = customDomains.find(isCustomDomainActive);
  if (activeCustomDomain) {
    return {
      url: `https://${activeCustomDomain.domain}/mcp`,
      type: "custom_domain",
      label: "Custom Domain",
      isPrimary: true,
    };
  }

  // Priority 2: Custom subdomain (paid tiers only)
  if (isPaidTier(organization.subscription_tier) && organization.custom_subdomain) {
    return {
      url: `https://${organization.custom_subdomain}.${BASE_DOMAIN}/mcp`,
      type: "custom_subdomain",
      label: "Custom Subdomain",
      isPrimary: true,
    };
  }

  // Priority 3: Auto-generated subdomain (all users)
  // Prefer the auto_subdomain from API if available, otherwise generate
  const autoSubdomain = organization.auto_subdomain || generateSubdomain(organization.id);
  return {
    url: `https://${autoSubdomain}.${BASE_DOMAIN}/mcp`,
    type: "auto_subdomain",
    label: "Auto Subdomain",
    isPrimary: true,
  };
}

/**
 * Get all available MCP URLs for an organization
 *
 * Returns all valid URLs the organization can use, in priority order.
 * Useful for showing alternatives or troubleshooting.
 *
 * @param config - Organization and domain configuration
 * @returns Array of MCP URL results
 */
export function getAllMcpUrls(config: McpUrlConfig): McpUrlResult[] {
  const { organization, customDomains = [] } = config;
  const urls: McpUrlResult[] = [];

  // Active custom domains
  for (const domain of customDomains.filter(isCustomDomainActive)) {
    urls.push({
      url: `https://${domain.domain}/mcp`,
      type: "custom_domain",
      label: `Custom: ${domain.domain}`,
      isPrimary: urls.length === 0,
    });
  }

  // Custom subdomain
  if (isPaidTier(organization.subscription_tier) && organization.custom_subdomain) {
    urls.push({
      url: `https://${organization.custom_subdomain}.${BASE_DOMAIN}/mcp`,
      type: "custom_subdomain",
      label: "Custom Subdomain",
      isPrimary: urls.length === 0,
    });
  }

  // Auto subdomain (always available)
  const autoSubdomain = organization.auto_subdomain || generateSubdomain(organization.id);
  urls.push({
    url: `https://${autoSubdomain}.${BASE_DOMAIN}/mcp`,
    type: "auto_subdomain",
    label: "Auto Subdomain",
    isPrimary: urls.length === 0,
  });

  // Legacy API URL (always works as fallback)
  urls.push({
    url: `${LEGACY_API_URL}/mcp`,
    type: "legacy",
    label: "Legacy API",
    isPrimary: false,
  });

  return urls;
}

/**
 * Get just the host portion of the MCP URL (without protocol or path)
 *
 * @param config - Organization and domain configuration
 * @returns The host (e.g., "swift-cloud-742.plexmcp.com")
 */
export function getMcpHost(config: McpUrlConfig): string {
  const result = getMcpUrl(config);
  const url = new URL(result.url);
  return url.host;
}

/**
 * Get the subdomain for display purposes
 *
 * @param organization - Organization information
 * @returns The subdomain (auto or custom)
 */
export function getDisplaySubdomain(organization: OrganizationForUrl): string {
  // Prefer custom subdomain on paid tiers
  if (isPaidTier(organization.subscription_tier) && organization.custom_subdomain) {
    return organization.custom_subdomain;
  }

  // Use auto subdomain
  return organization.auto_subdomain || generateSubdomain(organization.id);
}

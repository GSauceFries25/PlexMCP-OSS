// Admin Analytics types

// Query parameters for time-range based endpoints
export interface AnalyticsTimeRangeQuery {
  start?: string;
  end?: string;
  granularity?: "hourly" | "daily" | "weekly";
}

// Usage summary response
export interface UsageSummaryResponse {
  total_requests: number;
  total_tokens: number;
  total_errors: number;
  error_rate: number;
  avg_latency_ms: number | null;
  unique_organizations: number;
  unique_api_keys: number;
  unique_mcps: number;
  period_start: string;
  period_end: string;
}

// Usage time series
export interface UsageTimeSeriesPoint {
  timestamp: string;
  requests: number;
  tokens: number;
  errors: number;
  avg_latency_ms: number | null;
}

export interface UsageTimeSeriesResponse {
  data: UsageTimeSeriesPoint[];
  granularity: string;
}

// Revenue metrics
export interface RevenueTrendPoint {
  date: string;
  mrr_cents: number;
  overage_cents: number;
}

export interface RevenueMetricsResponse {
  mrr_cents: number;
  overage_revenue_cents: number;
  total_revenue_mtd_cents: number;
  subscribers_by_tier: Record<string, number>;
  trend: RevenueTrendPoint[];
}

// User activity metrics
export interface SignupTrendPoint {
  date: string;
  signups: number;
  active_users: number;
}

export interface UserActivityResponse {
  active_users_24h: number;
  active_users_7d: number;
  active_users_30d: number;
  new_signups_today: number;
  new_signups_week: number;
  new_signups_month: number;
  trend: SignupTrendPoint[];
}

// Top MCPs
export interface TopMcpEntry {
  mcp_id: string;
  mcp_name: string;
  org_name: string;
  request_count: number;
  error_count: number;
  avg_latency_ms: number | null;
}

export interface TopMcpsResponse {
  mcps: TopMcpEntry[];
  period: string;
}

// Top Organizations
export interface TopOrgEntry {
  org_id: string;
  org_name: string;
  subscription_tier: string;
  request_count: number;
  member_count: number;
  mcp_count: number;
}

export interface TopOrgsResponse {
  organizations: TopOrgEntry[];
  period: string;
}

// Spend cap utilization
export interface SpendCapUtilizationEntry {
  org_id: string;
  org_name: string;
  cap_amount_cents: number;
  current_spend_cents: number;
  utilization_pct: number;
  is_paused: boolean;
}

export interface SpendCapUtilizationResponse {
  caps: SpendCapUtilizationEntry[];
  total_with_caps: number;
  total_paused: number;
}

// Tier pricing for display
export const TIER_PRICES: Record<string, number> = {
  free: 0,
  pro: 29,
  team: 99,
  enterprise: 499,
};

export const TIER_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

// Helper to format cents to dollars
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

// Helper to format large numbers
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

// Helper to format percentage
export function formatPercent(num: number, decimals = 1): string {
  return `${num.toFixed(decimals)}%`;
}

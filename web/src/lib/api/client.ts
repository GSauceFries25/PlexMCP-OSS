import type { Organization, MCP, ApiKey, User, UsageLog, AuditLog } from "@/types/database";
import type {
  SupportTicket,
  SupportTicketWithDetails,
  TicketMessage,
  TicketMessageWithSender,
  TicketWithMessages,
  FAQArticle,
  CreateTicketRequest,
  ReplyToTicketRequest,
  UpdateTicketRequest,
  TicketStats,
  TicketFilters,
  TicketCategory,
  TicketStatus,
  TicketPriority,
  StaffEmailAssignment,
  AssignStaffEmailRequest,
  AutoGenerateEmailRequest,
  RemoveStaffEmailResponse,
} from "@/types/support";

// API URL must be configured via environment variable for self-hosted deployments
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
  /** Optional device token for "remember this device" feature */
  device_token?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  /** Device token for "remember this device" feature (only returned when remember_device is true) */
  device_token?: string;
}

// Organization types
export interface CreateOrganizationRequest {
  name: string;
  slug: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  settings?: Record<string, unknown>;
  custom_subdomain?: string;
}

// Custom subdomain availability check types
export interface CheckSubdomainRequest {
  subdomain: string;
}

export interface CheckSubdomainResponse {
  available: boolean;
  reason?: string;
}

// MCP types
export interface CreateMCPRequest {
  name: string;
  mcp_type: string;           // "http" | "stdio" | "websocket" | "custom"
  description?: string;
  is_active?: boolean;        // Whether the MCP is active (defaults to true when not specified)
  config?: {
    endpoint_url?: string;    // Required for HTTP type, stored in config
    api_key?: string;         // Optional authentication, stored securely
    auth_type?: "bearer" | "api-key" | "basic";  // Auth type for the API key
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface UpdateMCPRequest {
  name?: string;
  description?: string;
  is_active?: boolean;
  config?: {
    endpoint_url?: string;
    api_key?: string;
    auth_type?: "bearer" | "api-key" | "basic";
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface MCPHealthCheckResponse {
  mcp_id: string;
  health_status: "healthy" | "unhealthy" | "unknown";
  checked_at: string;
  details: MCPHealthCheckDetails;
}

export interface MCPHealthCheckDetails {
  protocol_version?: string;
  server_name?: string;
  server_version?: string;
  tools_count?: number;
  resources_count?: number;
  latency_ms: number;
  error?: string;
}

// Test History types
export interface TestHistoryEntry {
  id: string;
  mcp_id: string;
  health_status: "healthy" | "unhealthy" | "unknown";
  protocol_version?: string;
  server_name?: string;
  server_version?: string;
  tools_count?: number;
  resources_count?: number;
  latency_ms: number;
  error_message?: string;
  tested_at: string;
  tested_by?: string;
}

// Config Validation types
export interface ValidationCheck {
  check: string;
  passed: boolean;
  message: string;
  latency_ms?: number;
}

export interface ConfigValidationResponse {
  mcp_id: string;
  validations: ValidationCheck[];
  all_passed: boolean;
}

// Batch Test types
export interface BatchTestResult {
  mcp_id: string;
  mcp_name: string;
  health_status: "healthy" | "unhealthy";
  tools_count?: number;
  latency_ms: number;
  error?: string;
}

export interface BatchTestResponse {
  results: BatchTestResult[];
  total: number;
  healthy: number;
  unhealthy: number;
  tested_at: string;
}

// API Key types
export interface CreateApiKeyRequest {
  name: string;
  scopes?: string[];
  expires_at?: string;
  pin?: string; // Optional PIN for encrypting the key (if user has PIN set)
  /** MCP access mode: "all" (default), "selected", or "none" */
  mcp_access_mode?: "all" | "selected" | "none";
  /** When mcp_access_mode is "selected", the list of allowed MCP IDs */
  allowed_mcp_ids?: string[];
}

export interface RotateApiKeyRequest {
  pin?: string; // Optional PIN for encrypting the new key (if user has PIN set)
}

export interface CreateApiKeyResponse {
  api_key: ApiKey;
  secret: string; // Only returned once on creation
}

export interface RotateApiKeyResponse {
  id: string;
  name: string;
  key: string; // The new key value after rotation (backend uses "key")
  key_prefix: string;
  old_key_prefix: string;
  rotated_at: string;
  // Alias for compatibility - frontend can use either
  secret?: string;
}

export interface UpdateApiKeyRequest {
  name?: string;
  scopes?: string[];
  rate_limit_rpm?: number;
  /** MCP access mode: "all", "selected", or "none" */
  mcp_access_mode?: "all" | "selected" | "none";
  /** When mcp_access_mode is "selected", the list of allowed MCP IDs */
  allowed_mcp_ids?: string[];
  /** ISO 8601 date string for expiration, empty string to clear, undefined to not change */
  expires_at?: string;
}

// Usage types
export interface UsageStats {
  total_requests: number;
  total_mcps: number;
  active_api_keys: number;
  period_start: string;
  period_end: string;
  daily_usage: DailyUsage[];
}

export interface DailyUsage {
  date: string;
  requests: number;
}

// Billing period usage for subscription limits
export interface BillingUsageResponse {
  org_id: string;
  tier: string;
  period_start: string;
  period_end: string;
  requests_used: number;
  requests_limit: number;
  percentage_used: number;
  is_over_limit: boolean;
}

// Real-time Usage Analytics types
export interface UsageSummaryResponse {
  total_requests: number;
  total_errors: number;
  avg_latency_ms: number | null;
  period_start: string;
  period_end: string;
}

export interface HourlyUsageItem {
  hour: string;
  requests: number;
  errors: number;
}

export interface McpUsageItem {
  mcp_instance_id: string;
  mcp_name: string;
  request_count: number;
  error_count: number;
  avg_latency_ms: number | null;
}

export interface RecentErrorItem {
  id: string;
  method: string;
  tool_name: string | null;
  resource_uri: string | null;
  status: string;
  error_message: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface LatencyBucket {
  range: string;
  count: number;
  percentage: number;
}

export interface LatencyDistributionResponse {
  buckets: LatencyBucket[];
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  total_requests: number;
}

export interface UsageTimeRangeParams {
  start?: string;
  end?: string;
}

// Billing types
export interface SubscriptionInfo {
  tier: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  scheduled_downgrade?: {
    to_tier: string;
    effective_date: string;
  };
}

export interface ScheduleDowngradeResponse {
  current_tier: string;
  new_tier: string;
  effective_date: string;
  message: string;
}

export interface ProrationPreview {
  current_tier: string;
  new_tier: string;
  proration_amount_cents: number;
  overage_amount_cents: number;
  total_amount_cents: number;
  days_remaining: number;
  description: string;
}

export interface ReactivateSubscriptionRequest {
  tier: string;
  billing_interval: string;
}

export interface ReactivationResponse {
  status: string;
  tier: string;
  billing_interval: string;
  credit_applied_cents: number;
  extra_trial_days: number;
  overages_deducted_cents: number;
  current_period_end: string;
  trial_end?: string;
  message: string;
}

// Add-on types
export interface AddonStatus {
  addon_type: string;
  name: string;
  description: string;
  price_cents: number;
  category: "resource_packs" | "features" | "premium";
  is_stackable: boolean;
  is_popular: boolean;
  enabled: boolean;
  quantity: number;
  included_in_tier: boolean;
  /** Whether addon is available for purchase at this tier */
  available_for_tier: boolean;
  /** Whether this is a Pro+ only addon */
  is_pro_only: boolean;
  /** Message explaining availability */
  availability_message?: string;
}

export interface AddonSpendInfo {
  /** Current monthly add-on spend in cents */
  current_spend_cents: number;
  /** Price cap in cents (for Free tier) */
  price_cap_cents?: number;
  /** Whether at or over price cap */
  at_price_cap: boolean;
  /** Suggested upgrade message */
  upgrade_message?: string;
}

export interface AddonsListResponse {
  addons: AddonStatus[];
  tier_includes_all: boolean;
  can_purchase: boolean;
  /** Current tier name */
  tier: string;
  /** Add-on spend tracking */
  spend_info: AddonSpendInfo;
}

export interface AddonInfo {
  id: string;
  addon_type: string;
  name: string;
  status: string;
  price_cents: number;
  quantity: number;
  created_at: string;
}

export interface EnableAddonRequest {
  quantity?: number;
}

export interface UpdateAddonQuantityRequest {
  quantity: number;
}

// Enable addon response - can be success or checkout required
export type EnableAddonResponse =
  | { type: "success" } & AddonInfo
  | {
      type: "checkout_required";
      session_id: string;
      checkout_url: string;
      message: string;
    };

export interface AddonQuantities {
  extra_requests: number;
  extra_mcps: number;
  extra_api_keys: number;
  extra_team_members: number;
}

export interface EffectiveLimitsResponse {
  tier: string;
  base_requests: number;
  addon_requests: number;
  effective_requests: number;
  base_mcps: number;
  addon_mcps: number;
  effective_mcps: number;
  base_api_keys: number;
  addon_api_keys: number;
  effective_api_keys: number;
  base_team_members: number;
  addon_team_members: number;
  effective_team_members: number;
  is_unlimited: boolean;
  addon_quantities: AddonQuantities;
}

export interface CreateCheckoutSessionRequest {
  tier: string;
  billing_interval?: "monthly" | "annual";
  success_url: string;
  cancel_url: string;
  /** If true, this is an upgrade from an existing paid subscription */
  is_upgrade?: boolean;
}

export interface CreateCheckoutSessionResponse {
  session_id: string;
  url: string;
}

// Overage types
export interface OverageCharge {
  id: string;
  period_start: string;
  period_end: string;
  actual_usage: number;
  included_limit: number;
  overage_amount: number;
  rate_per_1k: number;
  total_charge_cents: number;
  status: "pending" | "invoiced" | "paid" | "waived";
  created_at: string;
}

export interface OveragesResponse {
  charges: OverageCharge[];
  total_paid_cents: number;
  total_pending_cents: number;
}

export interface CurrentOverageResponse {
  current_usage: number;
  included_limit: number;
  overage_calls: number;
  overage_rate: number;
  estimated_charge_cents: number;
  period_ends_at: string | null;
}

// Accumulated overage for pay-now
export interface AccumulatedOverageResponse {
  total_cents: number;
  total_requests: number;
  charge_count: number;
}

// Pay now result - uses Checkout Session for GUARANTEED user interaction
export type PayNowResponse =
  | { status: "NoPendingCharges" }
  | {
      status: "PaymentRequired";
      checkout_session_id: string;
      checkout_url: string;
      amount_cents: number;
      charge_count: number;
    }
  | {
      status: "AlreadyPaid";
      amount_cents: number;
      charge_count: number;
    };

// Spend cap types
export interface SpendCapStatusResponse {
  has_cap: boolean;
  cap_amount_cents: number | null;
  current_spend_cents: number;
  percentage_used: number;
  hard_pause_enabled: boolean;
  is_paused: boolean;
  paused_at: string | null;
  has_override: boolean;
  override_until: string | null;
}

export interface SetSpendCapRequest {
  cap_amount_cents: number;
  hard_pause_enabled: boolean;
}

// Instant charge types
export interface InstantChargeResponse {
  id: string;
  amount_cents: number;
  overage_at_charge: number;
  status: string;
  created_at: string;
  paid_at: string | null;
}

// PIN types
export interface PinStatusResponse {
  has_pin: boolean;
  pin_set_at?: string;
  failed_attempts: number;
  is_locked: boolean;
  locked_until?: string;
}

export interface SetPinRequest {
  pin: string;
}

export interface ChangePinRequest {
  current_pin: string;
  new_pin: string;
}

export interface VerifyPinRequest {
  pin: string;
}

export interface VerifyPinResponse {
  valid: boolean;
  remaining_attempts?: number;
  is_locked: boolean;
}

export interface RevealKeyResponse {
  key: string;
  key_id: string;
  name: string;
}

export interface ForgotPinRequest {
  email: string;
}

export interface ResetPinRequest {
  token: string;
  new_pin: string;
}

export interface ResetPinResponse {
  invalidated_keys_count: number;
  message: string;
}

export interface MessageResponse {
  message: string;
}

// Password Change types
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface ChangePasswordResponse {
  message: string;
}

// Connected Account (Identity) types
export interface ConnectedIdentity {
  id: string;
  provider: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  linked_at: string;
  last_used_at: string | null;
}

export interface ProviderInfo {
  provider: string;
  display_name: string;
  is_connected: boolean;
}

export interface IdentitiesListResponse {
  identities: ConnectedIdentity[];
  has_password: boolean;
  available_providers: ProviderInfo[];
}

export interface LinkIdentityRequest {
  provider: string;
  provider_user_id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
}

// Two-Factor Authentication (2FA) types
export interface TwoFactorStatusResponse {
  is_enabled: boolean;
  enabled_at?: string;
  is_locked: boolean;
  locked_until?: string;
  backup_codes_remaining: number;
}

export interface TwoFactorSetupResponse {
  /** Setup token for confirming 2FA */
  setup_token: string;
  /** TOTP secret for manual entry */
  secret: string;
  /** QR code as data URL (base64 PNG) */
  qr_code: string;
  /** OTPAuth URI for authenticator apps */
  otpauth_uri: string;
  /** Setup expiry time */
  expires_at: string;
}

export interface TwoFactorConfirmRequest {
  /** Setup token from the setup response */
  setup_token: string;
  /** 6-digit TOTP code */
  code: string;
}

export interface TwoFactorConfirmResponse {
  /** Backup codes in XXXX-XXXX format */
  backup_codes: string[];
}

export interface TwoFactorVerifyRequest {
  /** 6-digit TOTP code or backup code */
  code: string;
}

export interface TwoFactorVerifyResponse {
  valid: boolean;
  remaining_attempts?: number;
  is_locked: boolean;
}

export interface TwoFactorDisableRequest {
  /** 6-digit TOTP code or backup code */
  code: string;
}

export interface Login2FARequest {
  /** Temporary token from initial login */
  temp_token: string;
  /** 6-digit TOTP code or backup code */
  code: string;
  /** Remember this device for 30 days */
  remember_device?: boolean;
}

// Trusted Device types
export interface TrustedDevice {
  id: string;
  device_name: string | null;
  ip_address: string | null;
  last_used_at: string;
  expires_at: string;
  created_at: string;
}

export interface TrustedDevicesResponse {
  devices: TrustedDevice[];
  total: number;
}

/** Login response when 2FA is required */
export interface TwoFactorRequiredResponse {
  requires_2fa: true;
  temp_token: string;
  user_id: string;
}

/** Union type for login response - either success or 2FA required */
export type LoginResponse = AuthResponse | TwoFactorRequiredResponse;

/** Type guard to check if login response requires 2FA */
export function requires2FA(response: LoginResponse): response is TwoFactorRequiredResponse {
  return 'requires_2fa' in response && response.requires_2fa === true;
}

/** Response for OAuth 2FA check endpoint */
export type Check2FAResponse =
  | { status: "ok" }
  | { status: "2fa_required"; temp_token: string; user_id: string };

/** Type guard to check if OAuth login requires 2FA */
export function oauthRequires2FA(response: Check2FAResponse): response is { status: "2fa_required"; temp_token: string; user_id: string } {
  return response.status === "2fa_required";
}

// Enterprise Inquiry types (public endpoint)
export interface EnterpriseInquiryRequest {
  company_name: string;
  work_email: string;
  company_size: string;
  use_case: string;
}

export interface EnterpriseInquiryResponse {
  success: boolean;
  ticket_number: string;
  message: string;
}

// Notification Preferences types
export interface NotificationPreferences {
  email_alerts: boolean;
  weekly_digest: boolean;
  usage_alerts: boolean;
  security_alerts: boolean;  // Always true, cannot be disabled
  api_error_notifications: boolean;
  marketing_emails: boolean;
}

export interface UpdateNotificationPreferencesRequest {
  email_alerts?: boolean;
  weekly_digest?: boolean;
  usage_alerts?: boolean;
  api_error_notifications?: boolean;
  marketing_emails?: boolean;
  // Note: security_alerts cannot be disabled
}

// Custom Domain types
export type DomainStatus = "pending" | "verifying" | "verified" | "active" | "failed" | "expired";

export interface CustomDomain {
  id: string;
  user_id: string;
  domain: string;
  subdomain?: string;
  verification_token: string;
  verification_status: DomainStatus;
  verification_attempts: number;
  last_verification_at?: string;
  verified_at?: string;
  ssl_status: DomainStatus;
  ssl_provisioned_at?: string;
  ssl_expires_at?: string;
  cname_target: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDomainRequest {
  domain: string;
  subdomain?: string;
}

// Verification result from DNS check
export interface VerificationResult {
  success: boolean;
  cname_valid: boolean;
  txt_valid: boolean;
  message: string;
}

// Full response from verify domain endpoint
export interface VerifyDomainResponse {
  domain: CustomDomain;
  verification_result: VerificationResult;
}

// API Client class
class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        cache: 'no-store', // Prevent browser caching of API responses
        credentials: 'include', // SOC 2 CC6.1: Send HttpOnly cookies for secure auth
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Backend returns errors in { "error": { "code": ..., "message": ... } } format
        // Check nested error.message first, then top-level message, then statusText
        return {
          error: {
            code: errorData.error?.code || `HTTP_${response.status}`,
            message: errorData.error?.message || errorData.message || response.statusText,
            details: errorData.error?.details || errorData.details,
          },
        };
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { data: undefined as T };
      }

      const data = await response.json();
      return { data };
    } catch (error) {
      return {
        error: {
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Network error",
        },
      };
    }
  }

  // Health check
  async health(): Promise<ApiResponse<{ status: string }>> {
    return this.request("/health");
  }

  // Auth endpoints
  async login(request: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return this.request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async register(request: RegisterRequest): Promise<ApiResponse<AuthResponse>> {
    return this.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    return this.request("/api/v1/auth/logout", {
      method: "POST",
    });
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<AuthResponse>> {
    return this.request("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }

  /** Change the current user's password */
  async changePassword(data: ChangePasswordRequest): Promise<ApiResponse<ChangePasswordResponse>> {
    return this.request("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // User endpoints
  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.request("/api/v1/users/me");
  }

  async updateCurrentUser(data: Partial<User>): Promise<ApiResponse<User>> {
    return this.request("/api/v1/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Organization endpoints
  async getOrganizations(): Promise<ApiResponse<Organization[]>> {
    return this.request("/api/v1/organizations");
  }

  async getOrganization(id: string): Promise<ApiResponse<Organization>> {
    return this.request(`/api/v1/organizations/${id}`);
  }

  async createOrganization(
    data: CreateOrganizationRequest
  ): Promise<ApiResponse<Organization>> {
    return this.request("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateOrganization(
    _id: string,
    data: UpdateOrganizationRequest
  ): Promise<ApiResponse<Organization>> {
    // Uses /org endpoint which gets org from JWT context
    return this.request(`/api/v1/org`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteOrganization(_id: string): Promise<ApiResponse<void>> {
    // Uses /org endpoint which gets org from JWT context
    return this.request(`/api/v1/org`, {
      method: "DELETE",
    });
  }

  /** Check if a custom subdomain is available */
  async checkSubdomainAvailability(
    subdomain: string
  ): Promise<ApiResponse<CheckSubdomainResponse>> {
    return this.request(`/api/v1/org/subdomain/check`, {
      method: "POST",
      body: JSON.stringify({ subdomain }),
    });
  }

  // MCP endpoints (using flat routes - org from JWT context)
  async getMCPs(_organizationId: string): Promise<ApiResponse<MCP[]>> {
    return this.request(`/api/v1/mcps`);
  }

  async getMCP(_organizationId: string, mcpId: string): Promise<ApiResponse<MCP>> {
    return this.request(`/api/v1/mcps/${mcpId}`);
  }

  async createMCP(
    _organizationId: string,
    data: CreateMCPRequest
  ): Promise<ApiResponse<MCP>> {
    return this.request(`/api/v1/mcps`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateMCP(
    _organizationId: string,
    mcpId: string,
    data: UpdateMCPRequest
  ): Promise<ApiResponse<MCP>> {
    return this.request(`/api/v1/mcps/${mcpId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteMCP(_organizationId: string, mcpId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/mcps/${mcpId}`, {
      method: "DELETE",
    });
  }

  async testMCPConnection(
    _organizationId: string,
    mcpId: string
  ): Promise<ApiResponse<MCPHealthCheckResponse>> {
    return this.request(`/api/v1/mcps/${mcpId}/health-check`, {
      method: "POST",
    });
  }

  async getTestHistory(
    _organizationId: string,
    mcpId: string
  ): Promise<ApiResponse<TestHistoryEntry[]>> {
    return this.request(`/api/v1/mcps/${mcpId}/test-history`, {
      method: "GET",
    });
  }

  async validateMCPConfig(
    _organizationId: string,
    mcpId: string
  ): Promise<ApiResponse<ConfigValidationResponse>> {
    return this.request(`/api/v1/mcps/${mcpId}/validate`, {
      method: "POST",
    });
  }

  async testAllMCPs(
    _organizationId: string
  ): Promise<ApiResponse<BatchTestResponse>> {
    return this.request(`/api/v1/mcps/test-all`, {
      method: "POST",
    });
  }

  // API Key endpoints (using flat routes - org from JWT context)
  async getApiKeys(_organizationId: string): Promise<ApiResponse<ApiKey[]>> {
    // Backend returns { api_keys: [...], total: N }
    const response = await this.request<{ api_keys: ApiKey[]; total: number }>(`/api/v1/api-keys`);
    if (response.data) {
      return { data: response.data.api_keys };
    }
    return { error: response.error };
  }

  async createApiKey(
    _organizationId: string,
    data: CreateApiKeyRequest
  ): Promise<ApiResponse<CreateApiKeyResponse>> {
    return this.request(`/api/v1/api-keys`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeApiKey(
    _organizationId: string,
    keyId: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/api-keys/${keyId}`, {
      method: "DELETE",
    });
  }

  async rotateApiKey(
    _organizationId: string,
    keyId: string,
    data?: RotateApiKeyRequest
  ): Promise<ApiResponse<RotateApiKeyResponse>> {
    return this.request(`/api/v1/api-keys/${keyId}/rotate`, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async updateApiKey(
    _organizationId: string,
    keyId: string,
    data: UpdateApiKeyRequest
  ): Promise<ApiResponse<ApiKey>> {
    return this.request(`/api/v1/api-keys/${keyId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Usage & Analytics endpoints (using flat routes)
  async getUsageStats(_organizationId: string): Promise<ApiResponse<UsageStats>> {
    return this.request(`/api/v1/usage/summary`);
  }

  async getBillingUsage(_organizationId: string): Promise<ApiResponse<BillingUsageResponse>> {
    return this.request(`/api/v1/usage`);
  }

  async getUsageLogs(
    _organizationId: string,
    params?: { page?: number; per_page?: number }
  ): Promise<ApiResponse<PaginatedResponse<UsageLog>>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("per_page", params.per_page.toString());

    const query = searchParams.toString();
    return this.request(`/api/v1/usage${query ? `?${query}` : ""}`);
  }

  async getAuditLogs(
    _organizationId: string,
    params?: { page?: number; per_page?: number }
  ): Promise<ApiResponse<PaginatedResponse<AuditLog>>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("per_page", params.per_page.toString());

    // Using usage endpoint as audit logs fallback
    const query = searchParams.toString();
    return this.request(`/api/v1/usage${query ? `?${query}` : ""}`);
  }

  // Real-time Usage Analytics endpoints
  async getUsageSummary(
    _organizationId: string,
    params?: UsageTimeRangeParams
  ): Promise<ApiResponse<UsageSummaryResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/usage/summary${query ? `?${query}` : ""}`);
  }

  async getHourlyUsage(
    _organizationId: string,
    params?: UsageTimeRangeParams
  ): Promise<ApiResponse<HourlyUsageItem[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/usage/hourly${query ? `?${query}` : ""}`);
  }

  async getUsageByMcp(
    _organizationId: string,
    params?: UsageTimeRangeParams
  ): Promise<ApiResponse<McpUsageItem[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/usage/by-mcp${query ? `?${query}` : ""}`);
  }

  async getRecentErrors(
    _organizationId: string,
    params?: UsageTimeRangeParams & { limit?: number }
  ): Promise<ApiResponse<RecentErrorItem[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/usage/errors${query ? `?${query}` : ""}`);
  }

  async getLatencyDistribution(
    _organizationId: string,
    params?: UsageTimeRangeParams
  ): Promise<ApiResponse<LatencyDistributionResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/usage/latency-distribution${query ? `?${query}` : ""}`);
  }

  // Billing endpoints (using flat routes)
  async getSubscription(
    _organizationId: string
  ): Promise<ApiResponse<SubscriptionInfo>> {
    return this.request(`/api/v1/billing/subscription`);
  }

  async createCheckoutSession(
    _organizationId: string,
    data: CreateCheckoutSessionRequest
  ): Promise<ApiResponse<CreateCheckoutSessionResponse>> {
    return this.request(`/api/v1/billing/checkout`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createPortalSession(
    _organizationId: string
  ): Promise<ApiResponse<{ portal_url: string }>> {
    return this.request(`/api/v1/billing/portal`, {
      method: "POST",
    });
  }

  async cancelSubscription(
    _organizationId: string
  ): Promise<ApiResponse<SubscriptionInfo>> {
    return this.request(`/api/v1/billing/subscription/cancel`, {
      method: "POST",
    });
  }

  async resumeSubscription(
    _organizationId: string
  ): Promise<ApiResponse<SubscriptionInfo>> {
    return this.request(`/api/v1/billing/subscription/resume`, {
      method: "POST",
    });
  }

  // Reactivate a cancelled subscription with proration credit
  async reactivateSubscription(
    _organizationId: string,
    data: ReactivateSubscriptionRequest
  ): Promise<ApiResponse<ReactivationResponse>> {
    return this.request(`/api/v1/billing/subscription/reactivate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Update subscription tier (upgrade/downgrade with proration)
  async updateSubscription(
    _organizationId: string,
    tier: string
  ): Promise<ApiResponse<SubscriptionInfo>> {
    return this.request(`/api/v1/billing/subscription`, {
      method: "PATCH",
      body: JSON.stringify({ tier }),
    });
  }

  // Preview proration for subscription upgrade
  async previewProration(
    _organizationId: string,
    tier: string
  ): Promise<ApiResponse<ProrationPreview>> {
    return this.request(`/api/v1/billing/subscription/preview-proration?tier=${encodeURIComponent(tier)}`);
  }

  // Schedule a downgrade to take effect at period end
  async scheduleDowngrade(
    _organizationId: string,
    tier: string
  ): Promise<ApiResponse<ScheduleDowngradeResponse>> {
    return this.request(`/api/v1/billing/subscription/downgrade`, {
      method: "POST",
      body: JSON.stringify({ tier }),
    });
  }

  // Cancel a scheduled downgrade
  async cancelScheduledDowngrade(
    _organizationId: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/billing/subscription/downgrade`, {
      method: "DELETE",
    });
  }

  // Get scheduled downgrade info (if any)
  async getScheduledDowngrade(
    _organizationId: string
  ): Promise<ApiResponse<ScheduleDowngradeResponse | null>> {
    return this.request(`/api/v1/billing/subscription/downgrade`);
  }

  // Overage endpoints
  async getOverages(
    _organizationId: string,
    limit?: number
  ): Promise<ApiResponse<OveragesResponse>> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/api/v1/billing/overages${query}`);
  }

  async getCurrentOverage(
    _organizationId: string
  ): Promise<ApiResponse<CurrentOverageResponse>> {
    return this.request(`/api/v1/billing/overages/current`);
  }

  // Accumulated overage for pay-now
  async getAccumulatedOverage(
    _organizationId: string
  ): Promise<ApiResponse<AccumulatedOverageResponse>> {
    return this.request(`/api/v1/billing/overages/accumulated`);
  }

  // Pay overages now
  async payOveragesNow(
    _organizationId: string
  ): Promise<ApiResponse<PayNowResponse>> {
    return this.request(`/api/v1/billing/overages/pay-now`, {
      method: "POST",
    });
  }

  // Spend cap endpoints
  async getSpendCap(
    _organizationId: string
  ): Promise<ApiResponse<SpendCapStatusResponse>> {
    return this.request(`/api/v1/billing/spend-cap`);
  }

  async setSpendCap(
    _organizationId: string,
    data: SetSpendCapRequest
  ): Promise<ApiResponse<SpendCapStatusResponse>> {
    return this.request(`/api/v1/billing/spend-cap`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async removeSpendCap(
    _organizationId: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/billing/spend-cap`, {
      method: "DELETE",
    });
  }

  // Instant charge history
  async getInstantCharges(
    _organizationId: string,
    limit?: number
  ): Promise<ApiResponse<InstantChargeResponse[]>> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/api/v1/billing/instant-charges${query}`);
  }

  // Add-on endpoints (using flat routes)
  async getAddons(
    _organizationId: string
  ): Promise<ApiResponse<AddonsListResponse>> {
    return this.request(`/api/v1/addons`);
  }

  async enableAddon(
    _organizationId: string,
    addonType: string,
    quantity?: number
  ): Promise<ApiResponse<EnableAddonResponse>> {
    return this.request(`/api/v1/addons/${addonType}/enable`, {
      method: "POST",
      body: JSON.stringify({ quantity }),
    });
  }

  async disableAddon(
    _organizationId: string,
    addonType: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/addons/${addonType}`, {
      method: "DELETE",
    });
  }

  async updateAddonQuantity(
    _organizationId: string,
    addonType: string,
    quantity: number
  ): Promise<ApiResponse<AddonInfo>> {
    return this.request(`/api/v1/addons/${addonType}/quantity`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    });
  }

  async checkAddon(
    _organizationId: string,
    addonType: string
  ): Promise<ApiResponse<boolean>> {
    return this.request(`/api/v1/addons/${addonType}`);
  }

  async getAddonQuantities(
    _organizationId: string
  ): Promise<ApiResponse<AddonQuantities>> {
    return this.request(`/api/v1/addons/quantities`);
  }

  async getEffectiveLimits(
    _organizationId: string
  ): Promise<ApiResponse<EffectiveLimitsResponse>> {
    return this.request(`/api/v1/usage/limits`);
  }

  // Team/Member endpoints (using flat routes)
  async getMembers(_organizationId: string): Promise<ApiResponse<(User & { role: string })[]>> {
    // Backend returns { users: [...], total: N }
    const response = await this.request<{ users: (User & { role: string })[]; total: number }>(`/api/v1/users`);
    if (response.data) {
      return { data: response.data.users };
    }
    return { error: response.error };
  }

  async inviteMember(
    _organizationId: string,
    data: { email: string; role: string }
  ): Promise<ApiResponse<{ invite_id: string }>> {
    return this.request(`/api/v1/users`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async removeMember(
    _organizationId: string,
    userId: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/users/${userId}`, {
      method: "DELETE",
    });
  }

  async updateMemberRole(
    _organizationId: string,
    userId: string,
    role: string
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  // PIN management endpoints
  async getPinStatus(): Promise<ApiResponse<PinStatusResponse>> {
    return this.request(`/api/v1/pin/status`);
  }

  async setPin(data: SetPinRequest): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/pin`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async changePin(data: ChangePinRequest): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/pin/change`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async verifyPin(data: VerifyPinRequest): Promise<ApiResponse<VerifyPinResponse>> {
    return this.request(`/api/v1/pin/verify`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deletePin(data: VerifyPinRequest): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/pin`, {
      method: "DELETE",
      body: JSON.stringify(data),
    });
  }

  async revealApiKey(keyId: string, pin: string): Promise<ApiResponse<RevealKeyResponse>> {
    return this.request(`/api/v1/api-keys/${keyId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  }

  // Forgot/Reset PIN (public endpoints - no auth required)
  async forgotPin(data: ForgotPinRequest): Promise<ApiResponse<MessageResponse>> {
    return this.request(`/api/v1/pin/forgot`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async resetPin(data: ResetPinRequest): Promise<ApiResponse<ResetPinResponse>> {
    return this.request(`/api/v1/pin/reset`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Two-Factor Authentication (2FA) endpoints

  /** Get current user's 2FA status */
  async get2FAStatus(): Promise<ApiResponse<TwoFactorStatusResponse>> {
    return this.request(`/api/v1/2fa/status`);
  }

  /** Begin 2FA setup - returns QR code and secret */
  async begin2FASetup(): Promise<ApiResponse<TwoFactorSetupResponse>> {
    return this.request(`/api/v1/2fa/setup`, {
      method: "POST",
    });
  }

  /** Confirm 2FA setup with TOTP code - returns backup codes */
  async confirm2FASetup(data: TwoFactorConfirmRequest): Promise<ApiResponse<TwoFactorConfirmResponse>> {
    return this.request(`/api/v1/2fa/setup/confirm`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Verify a 2FA code (TOTP or backup code) */
  async verify2FA(data: TwoFactorVerifyRequest): Promise<ApiResponse<TwoFactorVerifyResponse>> {
    return this.request(`/api/v1/2fa/verify`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Disable 2FA (requires valid code) */
  async disable2FA(data: TwoFactorDisableRequest): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/2fa/disable`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Regenerate backup codes (requires valid TOTP code) */
  async regenerateBackupCodes(data: TwoFactorVerifyRequest): Promise<ApiResponse<TwoFactorConfirmResponse>> {
    return this.request(`/api/v1/2fa/backup-codes/regenerate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Complete login with 2FA code (after initial login returns 2FA required) */
  async login2FA(data: Login2FARequest): Promise<ApiResponse<AuthResponse>> {
    return this.request(`/api/v1/auth/login/2fa`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Check if 2FA is required for OAuth-authenticated user (pass Supabase access token) */
  async check2FARequired(supabaseAccessToken: string): Promise<ApiResponse<Check2FAResponse>> {
    return this.request(`/api/v1/auth/check-2fa`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
      },
    });
  }

  // Trusted Device management endpoints

  /** List all trusted devices for the current user */
  async getTrustedDevices(): Promise<ApiResponse<TrustedDevice[]>> {
    const response = await this.request<TrustedDevicesResponse>(`/api/v1/2fa/devices`);
    if (response.data) {
      return { data: response.data.devices };
    }
    return { error: response.error };
  }

  /** Revoke a specific trusted device */
  async revokeTrustedDevice(deviceId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/2fa/devices/${deviceId}`, {
      method: "DELETE",
    });
  }

  /** Revoke all trusted devices (log out from all remembered devices) */
  async revokeAllTrustedDevices(): Promise<ApiResponse<{ revoked_count: number }>> {
    return this.request(`/api/v1/2fa/devices`, {
      method: "DELETE",
    });
  }

  // Connected Accounts (Identity) endpoints

  /** List all connected identities for the current user */
  async getIdentities(): Promise<ApiResponse<IdentitiesListResponse>> {
    return this.request(`/api/v1/account/identities`);
  }

  /** Get available OAuth providers */
  async getProviders(): Promise<ApiResponse<ProviderInfo[]>> {
    return this.request(`/api/v1/account/identities/providers`);
  }

  /** Link a new OAuth identity to the account */
  async linkIdentity(data: LinkIdentityRequest): Promise<ApiResponse<ConnectedIdentity>> {
    return this.request(`/api/v1/account/identities`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Unlink an OAuth identity from the account */
  async unlinkIdentity(provider: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/account/identities/${provider}`, {
      method: "DELETE",
    });
  }

  // Custom Domain endpoints
  async getDomains(): Promise<ApiResponse<CustomDomain[]>> {
    const response = await this.request<{ domains: CustomDomain[] }>(`/api/v1/domains`);
    if (response.data) {
      return { data: response.data.domains };
    }
    return { error: response.error };
  }

  async createDomain(domain: string): Promise<ApiResponse<CustomDomain>> {
    return this.request(`/api/v1/domains`, {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
  }

  async getDomain(domainId: string): Promise<ApiResponse<CustomDomain>> {
    return this.request(`/api/v1/domains/${domainId}`);
  }

  async deleteDomain(domainId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/domains/${domainId}`, {
      method: "DELETE",
    });
  }

  async verifyDomain(domainId: string): Promise<ApiResponse<VerifyDomainResponse>> {
    return this.request(`/api/v1/domains/${domainId}/verify`, {
      method: "POST",
    });
  }

  async toggleDomain(domainId: string, isActive: boolean): Promise<ApiResponse<CustomDomain>> {
    return this.request(`/api/v1/domains/${domainId}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    });
  }

  // Support Ticket endpoints
  async getTickets(
    _organizationId: string,
    params?: { status?: TicketStatus; limit?: number }
  ): Promise<ApiResponse<SupportTicketWithDetails[]>> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    const response = await this.request<{ tickets: SupportTicketWithDetails[] }>(
      `/api/v1/support/tickets${query ? `?${query}` : ""}`
    );
    if (response.data) {
      return { data: response.data.tickets };
    }
    return { error: response.error };
  }

  async getTicket(ticketId: string): Promise<ApiResponse<TicketWithMessages>> {
    return this.request(`/api/v1/support/tickets/${ticketId}`);
  }

  async adminGetTicket(ticketId: string): Promise<ApiResponse<TicketWithMessages>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}`);
  }

  async createTicket(
    _organizationId: string,
    data: CreateTicketRequest
  ): Promise<ApiResponse<SupportTicket>> {
    return this.request(`/api/v1/support/tickets`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async replyToTicket(
    ticketId: string,
    data: ReplyToTicketRequest
  ): Promise<ApiResponse<TicketMessage>> {
    return this.request(`/api/v1/support/tickets/${ticketId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async closeTicket(ticketId: string): Promise<ApiResponse<SupportTicket>> {
    return this.request(`/api/v1/support/tickets/${ticketId}/close`, {
      method: "POST",
    });
  }

  // FAQ endpoints (public)
  async getFAQs(category?: string): Promise<ApiResponse<FAQArticle[]>> {
    const query = category ? `?category=${encodeURIComponent(category)}` : "";
    const response = await this.request<{ articles: FAQArticle[] }>(
      `/api/v1/support/faq${query}`
    );
    if (response.data) {
      return { data: response.data.articles };
    }
    return { error: response.error };
  }

  async searchFAQs(query: string): Promise<ApiResponse<FAQArticle[]>> {
    const response = await this.request<{ articles: FAQArticle[] }>(
      `/api/v1/support/faq/search?q=${encodeURIComponent(query)}`
    );
    if (response.data) {
      return { data: response.data.articles };
    }
    return { error: response.error };
  }

  async submitFAQFeedback(
    articleId: string,
    helpful: boolean
  ): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/support/faq/${articleId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ helpful }),
    });
  }

  // Enterprise Inquiry (public - no auth required)
  async submitEnterpriseInquiry(
    data: EnterpriseInquiryRequest
  ): Promise<ApiResponse<EnterpriseInquiryResponse>> {
    return this.request(`/api/v1/public/enterprise-inquiry`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Admin Support endpoints
  async adminGetAllTickets(
    params?: {
      status?: TicketStatus[];
      priority?: TicketPriority[];
      category?: TicketCategory[];
      search?: string;
      page?: number;
      per_page?: number;
    }
  ): Promise<ApiResponse<{ tickets: SupportTicketWithDetails[]; total: number }>> {
    const searchParams = new URLSearchParams();
    if (params?.status?.length) {
      params.status.forEach(s => searchParams.append("status", s));
    }
    if (params?.priority?.length) {
      params.priority.forEach(p => searchParams.append("priority", p));
    }
    if (params?.category?.length) {
      params.category.forEach(c => searchParams.append("category", c));
    }
    if (params?.search) searchParams.set("search", params.search);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("per_page", params.per_page.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/support/tickets${query ? `?${query}` : ""}`);
  }

  async adminGetTicketStats(): Promise<ApiResponse<TicketStats>> {
    return this.request(`/api/v1/admin/support/stats`);
  }

  async adminUpdateTicket(
    ticketId: string,
    data: UpdateTicketRequest
  ): Promise<ApiResponse<SupportTicket>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async adminReplyToTicket(
    ticketId: string,
    content: string
  ): Promise<ApiResponse<TicketMessage>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}/reply`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  async adminAssignTicket(
    ticketId: string,
    assignToUserId: string | null
  ): Promise<ApiResponse<SupportTicket>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to: assignToUserId }),
    });
  }

  async getAdminStaff(): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/staff`);
  }

  // Enhanced admin support methods (SLA, Workload, Templates, Batch)

  async adminGetTicketStatsEnhanced(): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/stats/enhanced`);
  }

  async adminGetWorkload(): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/workload`);
  }

  async adminGetAssignmentHistory(ticketId: string): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}/history`);
  }

  async adminReplyWithInternal(
    ticketId: string,
    content: string,
    isInternal: boolean
  ): Promise<ApiResponse<TicketMessage>> {
    return this.request(`/api/v1/admin/support/tickets/${ticketId}/reply-internal`, {
      method: "POST",
      body: JSON.stringify({ content, is_internal: isInternal }),
    });
  }

  async adminBatchAssign(data: {
    ticket_ids: string[];
    assigned_to: string | null;
    reason?: string;
  }): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/tickets/batch/assign`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminBatchStatus(data: {
    ticket_ids: string[];
    status: TicketStatus;
  }): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/tickets/batch/status`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Staff Email Assignment endpoints (Day 5)
  async adminListStaffEmails(): Promise<ApiResponse<StaffEmailAssignment[]>> {
    return this.request(`/api/v1/admin/support/staff/emails`);
  }

  async adminAssignStaffEmail(data: AssignStaffEmailRequest): Promise<ApiResponse<StaffEmailAssignment>> {
    return this.request(`/api/v1/admin/support/staff/emails`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminAutoGenerateStaffEmail(data: AutoGenerateEmailRequest): Promise<ApiResponse<StaffEmailAssignment>> {
    return this.request(`/api/v1/admin/support/staff/emails/auto-generate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminRemoveStaffEmail(assignmentId: string): Promise<ApiResponse<RemoveStaffEmailResponse>> {
    return this.request(`/api/v1/admin/support/staff/emails/${assignmentId}`, {
      method: "DELETE",
    });
  }

  // SLA Rules endpoints
  async adminGetSlaRules(): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/sla/rules`);
  }

  async adminCreateSlaRule(data: {
    name: string;
    priority: TicketPriority;
    category?: TicketCategory | null;
    first_response_hours: number;
    resolution_hours: number;
    business_hours_only?: boolean;
  }): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/sla/rules`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminUpdateSlaRule(
    ruleId: string,
    data: {
      name?: string;
      first_response_hours?: number;
      resolution_hours?: number;
      business_hours_only?: boolean;
      is_active?: boolean;
    }
  ): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/sla/rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Template endpoints
  async adminGetTemplates(): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/templates`);
  }

  async adminCreateTemplate(data: {
    name: string;
    category?: TicketCategory | null;
    content: string;
    shortcut?: string | null;
  }): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/templates`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminUpdateTemplate(
    templateId: string,
    data: {
      name?: string;
      category?: TicketCategory | null;
      content?: string;
      shortcut?: string | null;
      is_active?: boolean;
    }
  ): Promise<ApiResponse<unknown>> {
    return this.request(`/api/v1/admin/support/templates/${templateId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async adminDeleteTemplate(templateId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/admin/support/templates/${templateId}`, {
      method: "DELETE",
    });
  }

  // Notification Preferences endpoints

  /** Get current user's notification preferences */
  async getNotificationPreferences(): Promise<ApiResponse<NotificationPreferences>> {
    return this.request(`/api/v1/notification-preferences`);
  }

  /** Update notification preferences */
  async updateNotificationPreferences(
    data: UpdateNotificationPreferencesRequest
  ): Promise<ApiResponse<NotificationPreferences>> {
    return this.request(`/api/v1/notification-preferences`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Admin endpoints (platform admin only)
  async adminGetAllUsers(
    params?: { page?: number; per_page?: number }
  ): Promise<ApiResponse<PaginatedResponse<User>>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("limit", params.per_page.toString());

    const query = searchParams.toString();
    return this.request(`/api/v1/admin/users${query ? `?${query}` : ""}`);
  }

  async adminGetAllOrganizations(
    params?: { page?: number; per_page?: number }
  ): Promise<ApiResponse<PaginatedResponse<Organization>>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("per_page", params.per_page.toString());

    const query = searchParams.toString();
    return this.request(`/api/v1/admin/organizations${query ? `?${query}` : ""}`);
  }

  async adminGetPlatformStats(): Promise<
    ApiResponse<{
      total_users: number;
      total_organizations: number;
      total_mcps: number;
      total_requests_today: number;
      revenue_mtd: number;
    }>
  > {
    return this.request("/api/v1/admin/stats");
  }

  async adminGetUser(userId: string): Promise<ApiResponse<AdminUserResponse>> {
    return this.request(`/api/v1/admin/users/${userId}`);
  }

  async adminUpdateUser(
    userId: string,
    data: AdminUpdateUserRequest
  ): Promise<ApiResponse<AdminUserResponse>> {
    return this.request(`/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async adminSetUsage(
    data: AdminSetUsageRequest
  ): Promise<ApiResponse<AdminSetUsageResponse>> {
    return this.request("/api/v1/admin/usage/set", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async adminResetUsage(orgId: string): Promise<ApiResponse<AdminSetUsageResponse>> {
    return this.request(`/api/v1/admin/usage/${orgId}/reset`, {
      method: "POST",
    });
  }

  // Admin user action methods
  async adminRevokeUserSessions(userId: string): Promise<ApiResponse<AdminRevokeSessionsResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/revoke-sessions`, {
      method: "POST",
    });
  }

  async adminForcePasswordReset(userId: string): Promise<ApiResponse<AdminForcePasswordResetResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/force-password-reset`, {
      method: "POST",
    });
  }

  async adminDisable2FA(userId: string): Promise<ApiResponse<AdminDisable2FAResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/disable-2fa`, {
      method: "POST",
    });
  }

  async adminSuspendUser(userId: string, data?: AdminSuspendUserRequest): Promise<ApiResponse<AdminSuspendUserResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    });
  }

  async adminUnsuspendUser(userId: string): Promise<ApiResponse<AdminSuspendUserResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/unsuspend`, {
      method: "POST",
    });
  }

  async adminDeleteUser(userId: string): Promise<ApiResponse<AdminDeleteUserResponse>> {
    return this.request(`/api/v1/admin/users/${userId}`, {
      method: "DELETE",
    });
  }

  async adminRevokeUserApiKey(userId: string, keyId: string): Promise<ApiResponse<AdminRevokeApiKeyResponse>> {
    return this.request(`/api/v1/admin/users/${userId}/api-keys/${keyId}`, {
      method: "DELETE",
    });
  }

  // =========================================================================
  // Enterprise Custom Limits endpoints (admin only)
  // =========================================================================

  /** Get organization's current and effective limits */
  async adminGetOrgLimits(orgId: string): Promise<ApiResponse<OrgCustomLimitsResponse>> {
    return this.request(`/api/v1/admin/orgs/${orgId}/limits`);
  }

  /** Set or update custom limits for an organization (enterprise tier only) */
  async adminSetOrgLimits(
    orgId: string,
    data: SetCustomLimitsRequest
  ): Promise<ApiResponse<OrgCustomLimitsResponse>> {
    return this.request(`/api/v1/admin/orgs/${orgId}/limits`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /** Clear all custom limits for an organization (revert to tier defaults) */
  async adminClearOrgLimits(orgId: string): Promise<ApiResponse<OrgCustomLimitsResponse>> {
    return this.request(`/api/v1/admin/orgs/${orgId}/limits`, {
      method: "DELETE",
    });
  }

  /** Get limit change history for an organization */
  async adminGetLimitHistory(
    orgId: string,
    params?: { page?: number; per_page?: number }
  ): Promise<ApiResponse<LimitChangeHistoryResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.per_page) searchParams.set("per_page", params.per_page.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/orgs/${orgId}/limits/history${query ? `?${query}` : ""}`);
  }

  /** Get organization's overages status */
  async adminGetOrgOverages(orgId: string): Promise<ApiResponse<OrgOveragesResponse>> {
    return this.request(`/api/v1/admin/orgs/${orgId}/overages`);
  }

  /** Toggle overages for an organization */
  async adminToggleOrgOverages(
    orgId: string,
    data: ToggleOveragesRequest
  ): Promise<ApiResponse<OrgOveragesResponse>> {
    return this.request(`/api/v1/admin/orgs/${orgId}/overages`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // Team Invitation endpoints
  // =========================================================================

  /** List pending invitations for the organization */
  async listInvitations(): Promise<ApiResponse<InvitationsListResponse>> {
    return this.request("/api/v1/invitations");
  }

  /** Create and send a new invitation */
  async createInvitation(
    data: CreateInvitationRequest
  ): Promise<ApiResponse<InvitationResponse>> {
    return this.request("/api/v1/invitations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Resend an invitation email */
  async resendInvitation(invitationId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/invitations/${invitationId}/resend`, {
      method: "POST",
    });
  }

  /** Cancel a pending invitation */
  async cancelInvitation(invitationId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/invitations/${invitationId}`, {
      method: "DELETE",
    });
  }

  /** Validate an invitation token (public - no auth required) */
  async validateInvitation(token: string): Promise<ApiResponse<InvitationValidationResponse>> {
    return this.request(`/api/v1/invitations/validate?token=${encodeURIComponent(token)}`);
  }

  /** Accept an invitation and create account (public - no auth required) */
  async acceptInvitation(
    data: AcceptInvitationRequest
  ): Promise<ApiResponse<AcceptInvitationResponse>> {
    return this.request("/api/v1/invitations/accept", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // Admin Analytics endpoints
  // =========================================================================

  /** Get platform usage summary */
  async adminGetUsageSummary(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<AdminUsageSummaryResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/usage/summary${query ? `?${query}` : ""}`);
  }

  /** Get usage time series data */
  async adminGetUsageTimeSeries(
    params?: { start?: string; end?: string; granularity?: "hourly" | "daily" | "weekly" }
  ): Promise<ApiResponse<AdminUsageTimeSeriesResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.granularity) searchParams.set("granularity", params.granularity);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/usage/timeseries${query ? `?${query}` : ""}`);
  }

  /** Get revenue metrics */
  async adminGetRevenueMetrics(): Promise<ApiResponse<AdminRevenueMetricsResponse>> {
    return this.request("/api/v1/admin/analytics/revenue");
  }

  /** Get user activity metrics */
  async adminGetUserActivity(): Promise<ApiResponse<AdminUserActivityResponse>> {
    return this.request("/api/v1/admin/analytics/users");
  }

  /** Get top MCPs by usage */
  async adminGetTopMcps(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<AdminTopMcpsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/top-mcps${query ? `?${query}` : ""}`);
  }

  /** Get top organizations by usage */
  async adminGetTopOrgs(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<AdminTopOrgsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/top-organizations${query ? `?${query}` : ""}`);
  }

  /** Get spend cap utilization across platform */
  async adminGetSpendCapUtilization(): Promise<ApiResponse<AdminSpendCapUtilizationResponse>> {
    return this.request("/api/v1/admin/analytics/spend-caps");
  }

  // =========================================================================
  // Website Analytics endpoints (admin only)
  // =========================================================================

  /** Get realtime visitors */
  async getWebsiteAnalyticsRealtime(): Promise<ApiResponse<WebsiteRealtimeResponse>> {
    return this.request("/api/v1/admin/analytics/website/realtime");
  }

  /** Get website analytics overview */
  async getWebsiteAnalyticsOverview(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<WebsiteOverviewResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/overview${query ? `?${query}` : ""}`);
  }

  /** Get top pages */
  async getWebsiteAnalyticsPages(
    params?: { start?: string; end?: string; limit?: number }
  ): Promise<ApiResponse<WebsiteTopPagesResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/pages${query ? `?${query}` : ""}`);
  }

  /** Get traffic sources */
  async getWebsiteAnalyticsReferrers(
    params?: { start?: string; end?: string; limit?: number }
  ): Promise<ApiResponse<WebsiteReferrersResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/referrers${query ? `?${query}` : ""}`);
  }

  /** Get device breakdown */
  async getWebsiteAnalyticsDevices(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<WebsiteDevicesResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/devices${query ? `?${query}` : ""}`);
  }

  /** Get geographic breakdown */
  async getWebsiteAnalyticsLocations(
    params?: { start?: string; end?: string; limit?: number }
  ): Promise<ApiResponse<WebsiteLocationsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/locations${query ? `?${query}` : ""}`);
  }

  /** Get timeseries data for charts */
  async getWebsiteAnalyticsTimeseries(
    params?: { start?: string; end?: string; granularity?: string }
  ): Promise<ApiResponse<WebsiteTimeseriesResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.granularity) searchParams.set("granularity", params.granularity);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/timeseries${query ? `?${query}` : ""}`);
  }

  /** Get enhanced overview with period comparison */
  async getWebsiteAnalyticsOverviewEnhanced(
    params?: { start?: string; end?: string }
  ): Promise<ApiResponse<WebsiteOverviewEnhancedResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/overview-enhanced${query ? `?${query}` : ""}`);
  }

  /** Get custom events summary */
  async getWebsiteAnalyticsEvents(
    params?: { start?: string; end?: string; limit?: number }
  ): Promise<ApiResponse<WebsiteEventsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/events${query ? `?${query}` : ""}`);
  }

  /** Get event details (individual events) */
  async getWebsiteAnalyticsEventDetails(
    params?: { limit?: number; start?: string; end?: string }
  ): Promise<ApiResponse<WebsiteEventDetailsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/analytics/website/events/details${query ? `?${query}` : ""}`);
  }

  /** List all analytics goals */
  async getWebsiteAnalyticsGoals(): Promise<ApiResponse<WebsiteGoalsResponse>> {
    return this.request("/api/v1/admin/analytics/website/goals");
  }

  /** Create analytics goal */
  async createWebsiteAnalyticsGoal(
    data: CreateGoalRequest
  ): Promise<ApiResponse<WebsiteGoal>> {
    return this.request("/api/v1/admin/analytics/website/goals", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Update analytics goal */
  async updateWebsiteAnalyticsGoal(
    goalId: string,
    data: UpdateGoalRequest
  ): Promise<ApiResponse<WebsiteGoal>> {
    return this.request(`/api/v1/admin/analytics/website/goals/${goalId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /** Delete analytics goal */
  async deleteWebsiteAnalyticsGoal(goalId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/admin/analytics/website/goals/${goalId}`, {
      method: "DELETE",
    });
  }

  /** List website analytics alerts */
  async getWebsiteAnalyticsAlerts(params?: {
    is_resolved?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<WebsiteAlertsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.is_resolved !== undefined)
      searchParams.set("is_resolved", String(params.is_resolved));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const query = searchParams.toString();
    return this.request(
      `/api/v1/admin/analytics/website/alerts${query ? `?${query}` : ""}`
    );
  }

  /** Resolve website analytics alert */
  async resolveWebsiteAnalyticsAlert(
    alertId: string,
    data: ResolveAlertRequest
  ): Promise<ApiResponse<WebsiteAlert>> {
    return this.request(
      `/api/v1/admin/analytics/website/alerts/${alertId}/resolve`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
  }

  // =========================================================================
  // Admin Inbox endpoints
  // =========================================================================

  /** List inbox emails with optional filters */
  async adminGetInboxEmails(
    params?: AdminInboxEmailsParams
  ): Promise<ApiResponse<AdminInboxEmailsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.folder) searchParams.set("folder", params.folder);
    if (params?.is_read !== undefined) searchParams.set("is_read", params.is_read.toString());
    if (params?.is_starred !== undefined) searchParams.set("is_starred", params.is_starred.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());
    if (params?.assigned_email) searchParams.set("assigned_email", params.assigned_email);
    const query = searchParams.toString();
    return this.request(`/api/v1/admin/inbox/emails${query ? `?${query}` : ""}`);
  }

  /** Get single email by ID (auto-marks as read) */
  async adminGetInboxEmail(emailId: string): Promise<ApiResponse<AdminInboxEmail>> {
    return this.request(`/api/v1/admin/inbox/emails/${emailId}`);
  }

  /** Update email (read status, starred, move folder) */
  async adminUpdateInboxEmail(
    emailId: string,
    data: AdminUpdateInboxEmailRequest
  ): Promise<ApiResponse<AdminInboxEmail>> {
    return this.request(`/api/v1/admin/inbox/emails/${emailId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /** Compose and send new email */
  async adminComposeEmail(data: AdminComposeEmailRequest): Promise<ApiResponse<AdminInboxEmail>> {
    return this.request(`/api/v1/admin/inbox/compose`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Get folder counts */
  async adminGetInboxFolders(): Promise<ApiResponse<AdminInboxFoldersResponse>> {
    return this.request(`/api/v1/admin/inbox/folders`);
  }

  /** Get user's assigned email addresses */
  async adminGetAssignedEmails(): Promise<ApiResponse<AssignedEmailsResponse>> {
    return this.request(`/api/v1/admin/inbox/assigned-emails`);
  }

  // =========================================================================
  // Superadmin endpoints
  // =========================================================================

  /** Update user role (superadmin only) */
  async superadminUpdateUserRole(
    userId: string,
    data: SuperadminUpdateRoleRequest
  ): Promise<ApiResponse<SuperadminUpdateRoleResponse>> {
    return this.request(`/api/v1/superadmin/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /** Get audit logs (superadmin only) */
  async superadminGetAuditLogs(
    params?: SuperadminAuditLogsParams
  ): Promise<ApiResponse<SuperadminAuditLogsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.log_type) searchParams.set("log_type", params.log_type);
    if (params?.event_type) searchParams.set("event_type", params.event_type);
    if (params?.severity) searchParams.set("severity", params.severity);
    if (params?.actor_id) searchParams.set("actor_id", params.actor_id);
    if (params?.email) searchParams.set("email", params.email);
    if (params?.start_date) searchParams.set("start_date", params.start_date);
    if (params?.end_date) searchParams.set("end_date", params.end_date);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());
    const query = searchParams.toString();
    return this.request(`/api/v1/superadmin/audit-logs${query ? `?${query}` : ""}`);
  }

  /** Get system statistics (superadmin only) */
  async superadminGetSystemStats(): Promise<ApiResponse<SuperadminSystemStatsResponse>> {
    return this.request(`/api/v1/superadmin/system/stats`);
  }

  // =========================================================================
  // Email Routing Rules endpoints (admin)
  // =========================================================================

  /** List email routing rules */
  async adminGetEmailRoutingRules(): Promise<ApiResponse<AdminEmailRoutingRulesResponse>> {
    return this.request(`/api/v1/admin/email-routing`);
  }

  /** Create email routing rule */
  async adminCreateEmailRoutingRule(
    data: AdminCreateEmailRoutingRuleRequest
  ): Promise<ApiResponse<AdminEmailRoutingRule>> {
    return this.request(`/api/v1/admin/email-routing`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Update email routing rule */
  async adminUpdateEmailRoutingRule(
    ruleId: string,
    data: AdminUpdateEmailRoutingRuleRequest
  ): Promise<ApiResponse<AdminEmailRoutingRule>> {
    return this.request(`/api/v1/admin/email-routing/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /** Delete email routing rule */
  async adminDeleteEmailRoutingRule(ruleId: string): Promise<ApiResponse<void>> {
    return this.request(`/api/v1/admin/email-routing/${ruleId}`, {
      method: "DELETE",
    });
  }

  // =========================================================================
  // GDPR Compliance endpoints
  // =========================================================================

  /** Export all user data (GDPR Article 15 - Right to Access) */
  async gdprExportData(): Promise<ApiResponse<GdprDataExport>> {
    return this.request("/api/v1/gdpr/export");
  }

  /** Get deletion request status */
  async gdprGetDeletionStatus(): Promise<ApiResponse<GdprDeletionStatus>> {
    return this.request("/api/v1/gdpr/deletion");
  }

  /** Request account deletion (GDPR Article 17 - Right to Erasure) */
  async gdprRequestDeletion(confirmEmail: string, reason?: string): Promise<ApiResponse<GdprDeletionResponse>> {
    return this.request("/api/v1/gdpr/delete-request", {
      method: "POST",
      body: JSON.stringify({ confirm_email: confirmEmail, reason }),
    });
  }

  /** Cancel pending deletion request */
  async gdprCancelDeletion(): Promise<ApiResponse<{ message: string }>> {
    return this.request("/api/v1/gdpr/delete-request", {
      method: "DELETE",
    });
  }
}

// Website Analytics response types
export interface WebsiteRealtimeVisitor {
  session_id: string;
  current_page: string;
  country_code: string | null;
  device_type: string | null;
  last_activity_at: string;
}

export interface WebsiteRealtimeResponse {
  active_visitors: number;
  visitors: WebsiteRealtimeVisitor[];
}

export interface WebsiteOverviewResponse {
  visitors_today: number;
  sessions_today: number;
  page_views_today: number;
  bounce_rate: number;
  avg_session_duration_seconds: number | null;
  visitors_now: number;
}

export interface WebsiteTopPage {
  path: string;
  views: number;
  visitors: number;
  avg_time_seconds: number | null;
}

export interface WebsiteTopPagesResponse {
  pages: WebsiteTopPage[];
  period: string;
}

export interface WebsiteTrafficSource {
  source: string;
  visitors: number;
  sessions: number;
}

export interface WebsiteReferrersResponse {
  sources: WebsiteTrafficSource[];
  period: string;
}

export interface WebsiteDeviceBreakdown {
  device_type: string;
  count: number;
  percentage: number;
}

export interface WebsiteDevicesResponse {
  devices: WebsiteDeviceBreakdown[];
}

export interface WebsiteLocationEntry {
  country_code: string;
  visitors: number;
  percentage: number;
}

export interface WebsiteLocationsResponse {
  locations: WebsiteLocationEntry[];
}

// Timeseries types
export interface WebsiteTimeseriesPoint {
  timestamp: string;
  visitors: number;
  sessions: number;
  page_views: number;
  bounces: number;
}

export interface WebsiteTimeseriesResponse {
  data: WebsiteTimeseriesPoint[];
  granularity: string;
}

// Enhanced overview with period comparison
export interface WebsiteOverviewEnhancedResponse {
  visitors: number;
  sessions: number;
  page_views: number;
  views_per_visit: number;
  bounce_rate: number;
  avg_duration_seconds: number | null;
  visitors_now: number;
  prev_visitors: number;
  prev_sessions: number;
  prev_page_views: number;
  prev_views_per_visit: number;
  prev_bounce_rate: number;
  prev_avg_duration_seconds: number | null;
  visitors_change: number;
  sessions_change: number;
  page_views_change: number;
  views_per_visit_change: number;
  bounce_rate_change: number;
  duration_change: number;
}

// Events types
export interface WebsiteEventSummary {
  id: string;
  event_name: string;
  event_category: string | null;
  count: number;
}

export interface WebsiteEventsResponse {
  events: WebsiteEventSummary[];
  period: string;
}

export interface WebsiteEventDetail {
  id: string;
  event_name: string;
  event_category: string | null;
  event_data: Record<string, unknown> | null;
  page_url: string | null;
  created_at: string;
}

export interface WebsiteEventDetailsResponse {
  events: WebsiteEventDetail[];
  total: number;
}

// Goals types
export interface WebsiteGoal {
  id: string;
  name: string;
  description: string | null;
  event_name: string | null;
  url_pattern: string | null;
  goal_type: "event" | "pageview" | "engagement" | "duration";
  min_duration_seconds: number | null;
  min_page_views: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebsiteGoalsResponse {
  goals: WebsiteGoal[];
}

export interface CreateGoalRequest {
  name: string;
  description?: string;
  event_name?: string;
  url_pattern?: string;
  goal_type: string;
  min_duration_seconds?: number;
  min_page_views?: number;
}

export interface UpdateGoalRequest {
  name?: string;
  description?: string;
  event_name?: string;
  url_pattern?: string;
  goal_type?: string;
  min_duration_seconds?: number;
  min_page_views?: number;
  is_active?: boolean;
}

// Alerts types
export interface WebsiteAlert {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  metric_name: string;
  current_value: number;
  baseline_value: number;
  threshold_multiplier: number;
  triggered_at: string;
  resolved_at: string | null;
  is_resolved: boolean;
  resolution_note: string | null;
  time_window_minutes: number;
  alert_data: any | null;
}

export interface WebsiteAlertsResponse {
  alerts: WebsiteAlert[];
  total: number;
}

export interface ResolveAlertRequest {
  resolution_note?: string;
}

// Admin Analytics response types
export interface AdminUsageSummaryResponse {
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

export interface AdminUsageTimeSeriesPoint {
  timestamp: string;
  requests: number;
  tokens: number;
  errors: number;
  avg_latency_ms: number | null;
}

export interface AdminUsageTimeSeriesResponse {
  data: AdminUsageTimeSeriesPoint[];
  granularity: string;
}

export interface AdminRevenueTrendPoint {
  date: string;
  mrr_cents: number;
  overage_cents: number;
}

export interface AdminRevenueMetricsResponse {
  mrr_cents: number;
  overage_revenue_cents: number;
  total_revenue_mtd_cents: number;
  subscribers_by_tier: Record<string, number>;
  trend: AdminRevenueTrendPoint[];
}

export interface AdminSignupTrendPoint {
  date: string;
  signups: number;
  active_users: number;
}

export interface AdminUserActivityResponse {
  active_users_24h: number;
  active_users_7d: number;
  active_users_30d: number;
  new_signups_today: number;
  new_signups_week: number;
  new_signups_month: number;
  trend: AdminSignupTrendPoint[];
}

export interface AdminTopMcpEntry {
  mcp_id: string;
  mcp_name: string;
  org_name: string;
  request_count: number;
  error_count: number;
  avg_latency_ms: number | null;
}

export interface AdminTopMcpsResponse {
  mcps: AdminTopMcpEntry[];
  period: string;
}

export interface AdminTopOrgEntry {
  org_id: string;
  org_name: string;
  subscription_tier: string;
  request_count: number;
  member_count: number;
  mcp_count: number;
}

export interface AdminTopOrgsResponse {
  organizations: AdminTopOrgEntry[];
  period: string;
}

export interface AdminSpendCapEntry {
  org_id: string;
  org_name: string;
  cap_amount_cents: number;
  current_spend_cents: number;
  utilization_pct: number;
  is_paused: boolean;
}

export interface AdminSpendCapUtilizationResponse {
  caps: AdminSpendCapEntry[];
  total_with_caps: number;
  total_paused: number;
}

// Admin types
export interface AdminUserResponse {
  id: string;
  email: string;
  name?: string | null;
  org_id: string;
  org_name: string;
  subscription_tier: string;
  platform_role: "user" | "staff" | "admin" | "superadmin";
  role: string;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  usage: {
    requests_used: number;
    requests_limit: number;
    percentage_used: number;
    is_over_limit: boolean;
    billing_period_start: string | null;
    billing_period_end: string | null;
  };
  // Enhanced details
  is_suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  password_changed_at: string | null;
  security: AdminUserSecurityInfo;
  sessions: AdminUserSession[];
  login_history: AdminLoginHistoryEntry[];
  oauth_providers: AdminOAuthProvider[];
  trusted_devices: AdminTrustedDevice[];
  api_keys: AdminApiKeysInfo;
  has_payment_method?: boolean;
  // Billing period (top-level for convenience)
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  // Trial information
  trial_start?: string | null;
  trial_end?: string | null;
  subscription_status?: string | null;
  admin_trial_granted?: boolean;
  admin_trial_granted_by?: string | null;
  admin_trial_granted_at?: string | null;
  admin_trial_reason?: string | null;
  // Scheduled downgrade info
  scheduled_downgrade?: {
    current_tier: string;
    new_tier: string;
    effective_date: string;
    admin_scheduled_by?: string;
    admin_email?: string;
    reason?: string;
  } | null;
}

export interface AdminUserSecurityInfo {
  two_factor_enabled: boolean;
  two_factor_enabled_at: string | null;
  two_factor_last_used: string | null;
  has_backup_codes: boolean;
  backup_codes_remaining: number;
}

export interface AdminUserSession {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

export interface AdminLoginHistoryEntry {
  timestamp: string;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  failure_reason: string | null;
}

export interface AdminOAuthProvider {
  provider: string;
  email: string | null;
  display_name: string | null;
  linked_at: string;
  last_used_at: string | null;
}

export interface AdminTrustedDevice {
  id: string;
  device_name: string | null;
  ip_address: string | null;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface AdminApiKeysInfo {
  total_count: number;
  active_count: number;
  total_requests: number;
  keys: AdminApiKeyInfo[];
}

export interface AdminApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  request_count: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface AdminUpdateUserRequest {
  platform_role?: "user" | "staff" | "admin" | "superadmin";
  subscription_tier?: string;
  trial_days?: number;
  reason?: string;
  billing_interval?: "monthly" | "annual";
  custom_price_cents?: number;
  subscription_start_date?: string;
  payment_method?: "immediate" | "invoice" | "trial";
  // For downgrades: "scheduled" (at period end) or "immediate" (now with prorated credit/refund)
  downgrade_timing?: "scheduled" | "immediate";
  // For immediate downgrades: "refund" (money back) or "credit" (Stripe account credit)
  refund_type?: "refund" | "credit";
}

export interface AdminSetUsageRequest {
  org_id: string;
  request_count: number;
}

export interface AdminSetUsageResponse {
  org_id: string;
  request_count: number;
  message: string;
}

// Admin action request/response types
export interface AdminSuspendUserRequest {
  reason?: string;
}

export interface AdminSuspendUserResponse {
  user_id: string;
  is_suspended: boolean;
  sessions_revoked: number;
  message: string;
}

export interface AdminRevokeSessionsResponse {
  user_id: string;
  sessions_revoked: number;
  message: string;
}

export interface AdminForcePasswordResetResponse {
  user_id: string;
  sessions_revoked: number;
  message: string;
}

export interface AdminDisable2FAResponse {
  user_id: string;
  backup_codes_deleted: number;
  trusted_devices_deleted: number;
  message: string;
}

export interface AdminDeleteUserResponse {
  user_id: string;
  message: string;
}

export interface AdminRevokeApiKeyResponse {
  key_id: string;
  message: string;
}

// Invitation types
export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

export interface InvitationsListResponse {
  invitations: InvitationResponse[];
  total: number;
}

export interface CreateInvitationRequest {
  email: string;
  role: string;
}

export interface InvitationValidationResponse {
  valid: boolean;
  org_name: string | null;
  inviter_name: string | null;
  email: string | null;
  role: string | null;
  expires_at: string | null;
}

export interface AcceptInvitationRequest {
  token: string;
  password?: string;
  oauth_provider?: string;
  oauth_access_token?: string;
}

export interface AcceptInvitationResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    role: string;
    org_id: string;
    org_name: string;
  };
}

// Enterprise Custom Limits types
export interface TierLimitsInfo {
  max_mcps: number;
  max_api_keys: number;
  max_team_members: number;
  max_requests_monthly: number;
  overage_rate_cents: number | null;
}

export interface CustomLimitsInfo {
  max_mcps: number | null;
  max_api_keys: number | null;
  max_team_members: number | null;
  max_requests_monthly: number | null;
  overage_rate_cents: number | null;
  monthly_price_cents: number | null;
}

export interface EffectiveLimitsInfoAdmin {
  max_mcps: number;
  max_api_keys: number;
  max_team_members: number;
  max_requests_monthly: number;
  overage_rate_cents: number | null;
  monthly_price_cents: number | null;
  source: "tier" | "custom" | "mixed";
}

export interface UserBrief {
  id: string;
  email: string;
}

export interface OrgCustomLimitsResponse {
  org_id: string;
  org_name: string;
  subscription_tier: string;
  tier_limits: TierLimitsInfo;
  custom_limits: CustomLimitsInfo;
  effective_limits: EffectiveLimitsInfoAdmin;
  updated_at: string | null;
  updated_by: UserBrief | null;
  notes: string | null;
}

export interface SetCustomLimitsRequest {
  max_mcps?: number | null;
  max_api_keys?: number | null;
  max_team_members?: number | null;
  max_requests_monthly?: number | null;
  overage_rate_cents?: number | null;
  monthly_price_cents?: number | null;
  notes?: string | null;
}

export interface LimitChangeEntry {
  id: string;
  change_type: "set" | "update" | "remove";
  field_name: string;
  old_value: number | null;
  new_value: number | null;
  notes: string | null;
  changed_by: UserBrief;
  created_at: string;
}

export interface LimitChangeHistoryResponse {
  changes: LimitChangeEntry[];
  total: number;
}

// =========================================================================
// Organization Overages types
// =========================================================================

export interface OrgOveragesResponse {
  org_id: string;
  org_name: string;
  overages_disabled: boolean;
  subscription_tier: string;
  reason: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface ToggleOveragesRequest {
  disable_overages: boolean;
  reason?: string;
}

// =========================================================================
// Admin Inbox types
// =========================================================================

export interface AdminInboxEmail {
  id: string;
  message_id: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  folder: string;
  is_read: boolean;
  is_starred: boolean;
  in_reply_to: string | null;
  thread_references: string[] | null;
  received_at: string | null;
  created_at: string;
}

export interface AdminInboxEmailsParams {
  folder?: string;
  is_read?: boolean;
  is_starred?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  assigned_email?: string;  // NEW: "all" or specific email address
}

export interface AdminInboxEmailsResponse {
  emails: AdminInboxEmail[];
  total: number;
  unread_count: number;
}

export interface AdminUpdateInboxEmailRequest {
  is_read?: boolean;
  is_starred?: boolean;
  folder?: string;
}

export interface AdminComposeEmailRequest {
  from_address: string;     // NEW: Required for multi-email support
  to_addresses: string[];   // Fixed: Match DB array type
  cc_addresses?: string[];
  bcc_addresses?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
  in_reply_to?: string;
}

export interface AdminInboxFolder {
  name: string;
  unread_count: number;
  total_count: number;
}

export interface AdminInboxFoldersResponse {
  folders: AdminInboxFolder[];
}

export interface StaffEmailAssignmentBasic {
  id: string;
  user_id: string;
  email_address: string;
  is_active: boolean;
  auto_generated: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignedEmailsResponse {
  assignments: StaffEmailAssignmentBasic[];
}

// =========================================================================
// Superadmin types
// =========================================================================

export interface SuperadminUpdateRoleRequest {
  role: "user" | "staff" | "admin";
  reason: string;
}

export interface SuperadminUpdateRoleResponse {
  user_id: string;
  previous_role: string;
  new_role: string;
  updated_by: string;
  reason: string;
  updated_at: string;
}

export interface SuperadminAuditLog {
  id: string;
  log_type: string;
  event_type: string;
  severity: "info" | "warning" | "error" | "critical";
  actor_id: string | null;
  actor_email: string | null;
  target_id: string | null;
  target_type: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SuperadminAuditLogsParams {
  log_type?: string;
  event_type?: string;
  severity?: string;
  actor_id?: string;
  email?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface SuperadminAuditLogsResponse {
  logs: SuperadminAuditLog[];
  total: number;
}

export interface SuperadminSystemStatsResponse {
  active_api_keys: number;
  active_sessions: number;
  total_users: number;
  total_organizations: number;
}

// =========================================================================
// Email Routing Rules types
// =========================================================================

export type EmailRoutingActionType = "forward" | "auto_reply" | "assign" | "tag" | "move_folder" | "delete";

export interface AdminEmailRoutingRule {
  id: string;
  pattern: string;
  pattern_type: string;
  priority: number;
  action: string;
  ticket_category: string | null;
  route_to_user_id: string | null;
  forward_to_email: string | null;
  is_active: boolean;
  is_system: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface AdminEmailRoutingRulesResponse {
  rules: AdminEmailRoutingRule[];
  total: number;
}

export interface AdminCreateEmailRoutingRuleRequest {
  pattern: string;
  pattern_type: string;
  priority: number;
  action: string;
  ticket_category?: string | null;
  route_to_user_id?: string | null;
  forward_to_email?: string | null;
  description?: string | null;
}

export interface AdminUpdateEmailRoutingRuleRequest {
  pattern?: string;
  pattern_type?: string;
  priority?: number;
  action?: string;
  ticket_category?: string | null;
  route_to_user_id?: string | null;
  forward_to_email?: string | null;
  is_active?: boolean;
  description?: string | null;
}

// =========================================================================
// GDPR Compliance types
// =========================================================================

export interface GdprExportedUserData {
  id: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
  two_fa_enabled: boolean;
}

export interface GdprExportedOrgMembership {
  org_id: string;
  org_name: string;
  role: string;
  joined_at: string;
}

export interface GdprExportedApiKey {
  id: string;
  name: string;
  masked_key: string;
  created_at: string;
  last_used_at: string | null;
}

export interface GdprExportedTicket {
  id: string;
  ticket_number: string;
  subject: string;
  status: string;
  created_at: string;
}

export interface GdprExportedAuditEntry {
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface GdprExportedUsageRecord {
  date: string;
  request_count: number;
  tokens_used: number;
}

export interface GdprDataExport {
  user: GdprExportedUserData;
  organizations: GdprExportedOrgMembership[];
  api_keys: GdprExportedApiKey[];
  support_tickets: GdprExportedTicket[];
  audit_logs: GdprExportedAuditEntry[];
  usage_records: GdprExportedUsageRecord[];
  exported_at: string;
}

export interface GdprDeletionStatus {
  has_pending_request: boolean;
  request_id: string | null;
  scheduled_for: string | null;
  requested_at: string | null;
}

export interface GdprDeletionResponse {
  request_id: string;
  scheduled_for: string;
  message: string;
  can_cancel: boolean;
}

// Singleton instance
export const apiClient = new ApiClient();

// Helper to create a new client with auth token
export function createApiClient(accessToken?: string): ApiClient {
  const client = new ApiClient();
  if (accessToken) {
    client.setAccessToken(accessToken);
  }
  return client;
}

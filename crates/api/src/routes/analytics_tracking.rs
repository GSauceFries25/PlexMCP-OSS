//! Website Analytics Tracking API
//!
//! Public endpoint for collecting page views and events from the JavaScript tracking snippet.
//! This is the in-house Google Analytics replacement.

use axum::{
    extract::{Extension, Query, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use sqlx::{FromRow, Row};
use time::OffsetDateTime;
use uuid::Uuid;
use maxminddb::{geoip2, Reader};
use std::{net::IpAddr, sync::Arc};

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    routes::extract_client_ip,
    state::AppState,
};

// =============================================================================
// Timestamp Serialization Helper
// =============================================================================

mod timestamp_format {
    use serde::{Serializer, Deserializer, Serialize, Deserialize};
    use time::OffsetDateTime;
    use time::format_description::well_known::Rfc3339;

    pub fn serialize<S>(dt: &OffsetDateTime, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        dt.format(&Rfc3339)
            .map_err(serde::ser::Error::custom)?
            .serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<OffsetDateTime, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        OffsetDateTime::parse(&s, &Rfc3339)
            .map_err(serde::de::Error::custom)
    }
}

mod optional_timestamp_format {
    use serde::{Serializer, Deserializer, Deserialize};
    use time::OffsetDateTime;
    use time::format_description::well_known::Rfc3339;

    pub fn serialize<S>(dt: &Option<OffsetDateTime>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match dt {
            Some(dt) => {
                let formatted = dt.format(&Rfc3339)
                    .map_err(serde::ser::Error::custom)?;
                serializer.serialize_some(&formatted)
            }
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<OffsetDateTime>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt = Option::<String>::deserialize(deserializer)?;
        opt.map(|s| OffsetDateTime::parse(&s, &Rfc3339)
            .map_err(serde::de::Error::custom))
            .transpose()
    }
}

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CollectRequest {
    /// Current page URL
    pub url: String,
    /// Page title
    pub title: Option<String>,
    /// Referrer URL
    pub referrer: Option<String>,
    /// Client-provided session ID (from sessionStorage)
    pub session_id: Option<Uuid>,
    /// Client-provided visitor ID (from localStorage)
    pub visitor_id: Option<Uuid>,
    /// Screen width
    pub screen_width: Option<i32>,
    /// Screen height
    pub screen_height: Option<i32>,
    /// Custom event name (if tracking an event)
    pub event_name: Option<String>,
    /// Custom event data (JSON)
    pub event_data: Option<serde_json::Value>,
    /// UTM source
    pub utm_source: Option<String>,
    /// UTM medium
    pub utm_medium: Option<String>,
    /// UTM campaign
    pub utm_campaign: Option<String>,
    /// UTM term
    pub utm_term: Option<String>,
    /// UTM content
    pub utm_content: Option<String>,
    /// Time spent on previous page (seconds)
    pub time_on_page: Option<i32>,
    /// Scroll depth on previous page (0-100)
    pub scroll_depth: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct CollectResponse {
    pub session_id: Uuid,
    pub visitor_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct RealtimeVisitor {
    pub session_id: Uuid,
    pub current_page: String,
    pub country_code: Option<String>,
    pub device_type: Option<String>,
    #[serde(with = "timestamp_format")]
    pub last_activity_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct RealtimeResponse {
    pub active_visitors: i64,
    pub visitors: Vec<RealtimeVisitor>,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsOverview {
    pub visitors_today: i64,
    pub sessions_today: i64,
    pub page_views_today: i64,
    pub bounce_rate: f64,
    pub avg_session_duration_seconds: Option<i64>,
    pub visitors_now: i64,
}

#[derive(Debug, Serialize)]
pub struct TopPage {
    pub path: String,
    pub views: i64,
    pub visitors: i64,
    pub avg_time_seconds: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TopPagesResponse {
    pub pages: Vec<TopPage>,
    pub period: String,
}

#[derive(Debug, Serialize)]
pub struct TrafficSource {
    pub source: String,
    pub visitors: i64,
    pub sessions: i64,
}

#[derive(Debug, Serialize)]
pub struct TrafficSourcesResponse {
    pub sources: Vec<TrafficSource>,
    pub period: String,
}

#[derive(Debug, Serialize)]
pub struct DeviceBreakdown {
    pub device_type: String,
    pub count: i64,
    pub percentage: f64,
}

#[derive(Debug, Serialize)]
pub struct DevicesResponse {
    pub devices: Vec<DeviceBreakdown>,
}

#[derive(Debug, Serialize)]
pub struct LocationEntry {
    pub country_code: String,
    pub visitors: i64,
    pub percentage: f64,
}

#[derive(Debug, Serialize)]
pub struct LocationsResponse {
    pub locations: Vec<LocationEntry>,
}

#[derive(Debug, Deserialize)]
pub struct AnalyticsQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub limit: Option<i64>,
}

// =============================================================================
// Database Row Types
// =============================================================================

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct VisitorRow {
    id: Uuid,
    fingerprint_hash: String,
    visit_count: i32,
}

#[derive(Debug, FromRow)]
#[allow(dead_code)] // Fields populated from DB
struct SessionRow {
    id: Uuid,
    visitor_id: Uuid,
}

#[derive(Debug, FromRow)]
struct RealtimeRow {
    session_id: Uuid,
    current_page: Option<String>,
    country_code: Option<String>,
    device_type: Option<String>,
    last_activity_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct TopPageRow {
    url_path: String,
    views: i64,
    visitors: i64,
    avg_time_seconds: Option<i64>,
}

#[derive(Debug, FromRow)]
struct SourceRow {
    source: Option<String>,
    visitors: i64,
    sessions: i64,
}

#[derive(Debug, FromRow)]
struct DeviceRow {
    device_type: Option<String>,
    count: i64,
}

#[derive(Debug, FromRow)]
struct LocationRow {
    country_code: Option<String>,
    visitors: i64,
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Generate privacy-preserving fingerprint
fn generate_fingerprint(ip: &str, user_agent: &str) -> String {
    // Use current date as daily salt for rotation
    let date = OffsetDateTime::now_utc().date();
    let salt = format!("{}-{}-{}", date.year(), date.month() as u8, date.day());

    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}", ip, user_agent, salt));
    let result = hasher.finalize();
    hex::encode(result)
}

/// Hash IP for privacy
fn hash_ip(ip: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ip);
    let result = hasher.finalize();
    hex::encode(result)
}

/// Extract URL path from full URL
fn extract_path(url: &str) -> String {
    url::Url::parse(url)
        .map(|u| u.path().to_string())
        .unwrap_or_else(|_| url.to_string())
}

/// Extract domain from URL
fn extract_domain(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
}

/// Parse date range from query parameters with 30-day default
/// Returns (start, end, period_label)
fn parse_date_range(query: &AnalyticsQuery) -> (OffsetDateTime, OffsetDateTime, String) {
    let now = OffsetDateTime::now_utc();

    // Parse end date or use now
    let end = query.end.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(23, 59, 59).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(now);

    // Parse start date or default to 30 days before end
    let start = query.start.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(0, 0, 0).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(end - time::Duration::days(30));

    // Calculate period label
    let days = (end - start).whole_days();
    let period_label = if days <= 1 {
        "today".to_string()
    } else {
        format!("{}d", days)
    };

    (start, end, period_label)
}

/// Parse user agent for device type and browser
fn parse_user_agent(ua: &str) -> (String, Option<String>, Option<String>) {
    let ua_lower = ua.to_lowercase();

    // Device type
    let device_type = if ua_lower.contains("mobile") || ua_lower.contains("android") && !ua_lower.contains("tablet") {
        "mobile"
    } else if ua_lower.contains("tablet") || ua_lower.contains("ipad") {
        "tablet"
    } else if ua_lower.contains("bot") || ua_lower.contains("crawler") || ua_lower.contains("spider") {
        "bot"
    } else {
        "desktop"
    };

    // Browser detection (simplified)
    let browser = if ua_lower.contains("chrome") && !ua_lower.contains("edge") {
        Some("Chrome".to_string())
    } else if ua_lower.contains("safari") && !ua_lower.contains("chrome") {
        Some("Safari".to_string())
    } else if ua_lower.contains("firefox") {
        Some("Firefox".to_string())
    } else if ua_lower.contains("edge") {
        Some("Edge".to_string())
    } else {
        None
    };

    // OS detection (simplified)
    let os = if ua_lower.contains("windows") {
        Some("Windows".to_string())
    } else if ua_lower.contains("mac os") || ua_lower.contains("macos") {
        Some("macOS".to_string())
    } else if ua_lower.contains("linux") {
        Some("Linux".to_string())
    } else if ua_lower.contains("android") {
        Some("Android".to_string())
    } else if ua_lower.contains("ios") || ua_lower.contains("iphone") || ua_lower.contains("ipad") {
        Some("iOS".to_string())
    } else {
        None
    };

    (device_type.to_string(), browser, os)
}

/// Bot detection result
#[derive(Debug, Clone)]
struct BotDetectionResult {
    is_bot: bool,
    score: i32,
    patterns: Vec<String>,
}

/// Detect if request is from a bot based on user agent and IP patterns
fn detect_bot(user_agent: &str, ip: &str) -> BotDetectionResult {
    let mut score = 0;
    let mut patterns = Vec::new();
    let ua_lower = user_agent.to_lowercase();

    // Known bot user agents (high confidence)
    let bot_keywords = [
        ("bot", 30),
        ("crawler", 30),
        ("spider", 30),
        ("scraper", 30),
        ("curl", 25),
        ("wget", 25),
        ("python-requests", 25),
        ("java/", 20),
        ("go-http-client", 20),
        ("node-fetch", 20),
        ("axios", 20),
        ("googlebot", 35),
        ("bingbot", 35),
        ("slurp", 35),
        ("duckduckbot", 35),
        ("baiduspider", 35),
        ("yandexbot", 35),
        ("facebookexternalhit", 35),
        ("twitterbot", 35),
        ("linkedinbot", 35),
        ("whatsapp", 30),
        ("telegrambot", 30),
        ("discordbot", 30),
        ("slackbot", 30),
        ("phantomjs", 35),
        ("headlesschrome", 35),
        ("selenium", 35),
        ("webdriver", 35),
        ("puppeteer", 35),
        ("scrapy", 35),
        ("ahrefs", 30),
        ("semrush", 30),
        ("mj12bot", 30),
        ("dotbot", 30),
        ("rogerbot", 30),
        ("petalbot", 30),
    ];

    for (keyword, keyword_score) in bot_keywords.iter() {
        if ua_lower.contains(keyword) {
            score += keyword_score;
            patterns.push(format!("ua_contains_{}", keyword));
        }
    }

    // Suspicious patterns
    if ua_lower.is_empty() || ua_lower.len() < 10 {
        score += 25;
        patterns.push("ua_too_short".to_string());
    }

    if !ua_lower.contains("mozilla") && !ua_lower.contains("compatible") {
        score += 15;
        patterns.push("missing_mozilla".to_string());
    }

    // Check for automated tool signatures
    if ua_lower.contains("http") && !ua_lower.contains("mozilla") {
        score += 20;
        patterns.push("http_client".to_string());
    }

    // Private IP ranges (low bot score - legitimate internal traffic exists)
    if ip.starts_with("10.") || ip.starts_with("172.") || ip.starts_with("192.168.") {
        score += 1;
        patterns.push("private_ip".to_string());
    }

    // Score threshold: >= 30 is considered a bot
    let is_bot = score >= 30;

    BotDetectionResult {
        is_bot,
        score,
        patterns,
    }
}

/// Perform IP geolocation lookup using MaxMind database
/// Returns (country_code, region_code) or (None, None) on failure
fn geolocate_ip(
    geoip_reader: &Option<Arc<Reader<Vec<u8>>>>,
    ip_str: &str,
) -> (Option<String>, Option<String>) {
    // Early return if no database available
    let reader = match geoip_reader {
        Some(r) => r,
        None => return (None, None),
    };

    // Parse IP address
    let ip: IpAddr = match ip_str.parse() {
        Ok(ip) => ip,
        Err(_) => return (None, None),
    };

    // Skip private/local IPs (127.0.0.1, 192.168.x.x, etc.)
    let is_private = match ip {
        IpAddr::V4(ipv4) => ipv4.is_loopback() || ipv4.is_private(),
        IpAddr::V6(ipv6) => ipv6.is_loopback(),
    };
    if is_private {
        return (None, None);
    }

    // Lookup IP in database
    let lookup_result = match reader.lookup(ip) {
        Ok(result) => result,
        Err(_) => return (None, None),
    };

    // Decode as City data
    let city = match lookup_result.decode::<geoip2::City>() {
        Ok(Some(city)) => city,
        _ => return (None, None),
    };

    let country_code = city.country.iso_code.map(|s| s.to_string());
    let region_code = city.subdivisions
        .first()
        .and_then(|sub| sub.iso_code.map(|s| s.to_string()));

    (country_code, region_code)
}

/// Check if admin
async fn require_admin(pool: &sqlx::PgPool, auth_user: &AuthUser) -> ApiResult<()> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let role: Option<(String,)> = sqlx::query_as(
        "SELECT platform_role::TEXT FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    match role.map(|r| r.0).unwrap_or_default().as_str() {
        "superadmin" | "admin" | "staff" => Ok(()),
        _ => Err(ApiError::Forbidden),
    }
}

// =============================================================================
// Public Collect Endpoint (No Auth)
// =============================================================================

/// Collect page view or event (public endpoint with optional admin exclusion)
pub async fn collect(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth_user: Option<Extension<AuthUser>>,
    Json(req): Json<CollectRequest>,
) -> Result<Json<CollectResponse>, StatusCode> {
    // Extract client info
    let ip = extract_client_ip(&headers).unwrap_or_else(|| "0.0.0.0".to_string());
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Check analytics settings
    let settings: Option<(bool, bool, bool, bool, bool)> = sqlx::query_as(
        "SELECT respect_dnt, filter_bots, anonymize_ip, bot_detection_enabled, exclude_admin_visits FROM analytics_settings LIMIT 1"
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let (respect_dnt, filter_bots, _anonymize_ip, bot_detection_enabled, exclude_admin_visits) = settings.unwrap_or((true, true, true, true, true));

    // Check Do Not Track header
    if respect_dnt {
        if let Some(dnt) = headers.get("dnt") {
            if dnt == "1" {
                // Return client-provided IDs or generate new ones, don't record
                return Ok(Json(CollectResponse {
                    session_id: req.session_id.unwrap_or_else(Uuid::new_v4),
                    visitor_id: req.visitor_id.unwrap_or_else(Uuid::new_v4),
                }));
            }
        }
    }

    // Check if user is authenticated admin and should be excluded
    let (is_admin, admin_user_id) = if let Some(Extension(auth)) = auth_user {
        if let Some(user_id) = auth.user_id {
            // Check if user has admin/superadmin/staff role
            let role: Option<(String,)> = sqlx::query_as(
                "SELECT platform_role::TEXT FROM users WHERE id = $1"
            )
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();

            let is_admin = matches!(
                role.map(|r| r.0).as_deref(),
                Some("superadmin") | Some("admin") | Some("staff")
            );

            (is_admin, Some(user_id))
        } else {
            (false, None)
        }
    } else {
        (false, None)
    };

    // Exclude admin visits if enabled
    if exclude_admin_visits && is_admin {
        // Return client-provided IDs or generate new ones, don't record admin visits
        return Ok(Json(CollectResponse {
            session_id: req.session_id.unwrap_or_else(Uuid::new_v4),
            visitor_id: req.visitor_id.unwrap_or_else(Uuid::new_v4),
        }));
    }

    // Parse user agent
    let (device_type, browser, os) = parse_user_agent(&user_agent);

    // Advanced bot detection
    let bot_detection = detect_bot(&user_agent, &ip);

    // Perform IP geolocation lookup
    let (country_code, region_code) = geolocate_ip(&state.geoip_reader, &ip);

    // Filter bots if detection enabled
    if bot_detection_enabled && bot_detection.is_bot {
        // Return client-provided IDs or generate new ones, don't record bots
        return Ok(Json(CollectResponse {
            session_id: req.session_id.unwrap_or_else(Uuid::new_v4),
            visitor_id: req.visitor_id.unwrap_or_else(Uuid::new_v4),
        }));
    }

    // Fallback: legacy bot filtering by device type
    if filter_bots && device_type == "bot" && !bot_detection_enabled {
        return Ok(Json(CollectResponse {
            session_id: req.session_id.unwrap_or_else(Uuid::new_v4),
            visitor_id: req.visitor_id.unwrap_or_else(Uuid::new_v4),
        }));
    }

    // Generate fingerprint
    let fingerprint = generate_fingerprint(&ip, &user_agent);
    let ip_hash = hash_ip(&ip);

    // Find or create visitor with bot detection and admin tracking
    let visitor: VisitorRow = sqlx::query_as(
        r#"
        INSERT INTO analytics_visitors (fingerprint_hash, is_bot, bot_score, bot_patterns, is_admin, user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (fingerprint_hash) DO UPDATE SET
            last_seen_at = NOW(),
            visit_count = analytics_visitors.visit_count + 1,
            is_returning = true,
            is_bot = EXCLUDED.is_bot,
            bot_score = EXCLUDED.bot_score,
            bot_patterns = EXCLUDED.bot_patterns,
            is_admin = EXCLUDED.is_admin,
            user_id = EXCLUDED.user_id
        RETURNING id, fingerprint_hash, visit_count
        "#
    )
    .bind(&fingerprint)
    .bind(bot_detection.is_bot)
    .bind(bot_detection.score)
    .bind(&bot_detection.patterns)
    .bind(is_admin)
    .bind(admin_user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Get or create session
    let session_id = req.session_id.unwrap_or_else(Uuid::new_v4);
    let url_path = extract_path(&req.url);
    let referrer_domain = req.referrer.as_ref().and_then(|r| extract_domain(r));

    // Check if session exists and is not expired (30 minute timeout)
    let existing_session: Option<SessionRow> = sqlx::query_as(
        "SELECT id, visitor_id FROM analytics_sessions WHERE id = $1 AND started_at > NOW() - INTERVAL '30 minutes'"
    )
    .bind(session_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let final_session_id = if let Some(session) = existing_session {
        // Update session
        sqlx::query(
            r#"
            UPDATE analytics_sessions SET
                page_views = page_views + 1,
                exit_page = $2,
                is_bounce = false
            WHERE id = $1
            "#
        )
        .bind(session.id)
        .bind(&url_path)
        .execute(&state.pool)
        .await
        .ok();

        session.id
    } else {
        // Create new session with bot detection, admin tracking, and geolocation
        let new_session: SessionRow = sqlx::query_as(
            r#"
            INSERT INTO analytics_sessions (
                id, visitor_id, entry_page, exit_page, page_views,
                browser, os, device_type, screen_width, screen_height,
                referrer, referrer_domain, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                ip_hash, user_agent, is_bot, is_admin,
                country_code, region_code
            ) VALUES (
                $1, $2, $3, $3, 1,
                $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19,
                $20, $21
            )
            RETURNING id, visitor_id
            "#
        )
        .bind(session_id)
        .bind(visitor.id)
        .bind(&url_path)
        .bind(&browser)
        .bind(&os)
        .bind(&device_type)
        .bind(req.screen_width)
        .bind(req.screen_height)
        .bind(&req.referrer)
        .bind(&referrer_domain)
        .bind(&req.utm_source)
        .bind(&req.utm_medium)
        .bind(&req.utm_campaign)
        .bind(&req.utm_term)
        .bind(&req.utm_content)
        .bind(&ip_hash)
        .bind(&user_agent)
        .bind(bot_detection.is_bot)
        .bind(is_admin)
        .bind(&country_code)
        .bind(&region_code)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        new_session.id
    };

    // Record page view
    if req.event_name.is_none() {
        sqlx::query(
            r#"
            INSERT INTO analytics_page_views (session_id, visitor_id, url, url_path, title, referrer)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#
        )
        .bind(final_session_id)
        .bind(visitor.id)
        .bind(&req.url)
        .bind(&url_path)
        .bind(&req.title)
        .bind(&req.referrer)
        .execute(&state.pool)
        .await
        .ok();
    }

    // Record event if provided
    if let Some(event_name) = &req.event_name {
        sqlx::query(
            r#"
            INSERT INTO analytics_events (session_id, visitor_id, event_name, event_data, page_url, page_path)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#
        )
        .bind(final_session_id)
        .bind(visitor.id)
        .bind(event_name)
        .bind(&req.event_data)
        .bind(&req.url)
        .bind(&url_path)
        .execute(&state.pool)
        .await
        .ok();
    }

    // Update realtime table
    sqlx::query(
        r#"
        INSERT INTO analytics_realtime (session_id, visitor_id, current_page, device_type, country_code)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (session_id) DO UPDATE SET
            current_page = $3,
            last_activity_at = NOW()
        "#
    )
    .bind(final_session_id)
    .bind(visitor.id)
    .bind(&url_path)
    .bind(&device_type)
    .bind(&country_code)
    .execute(&state.pool)
    .await
    .ok();

    Ok(Json(CollectResponse {
        session_id: final_session_id,
        visitor_id: visitor.id,
    }))
}

// =============================================================================
// Admin Analytics Endpoints
// =============================================================================

/// Get realtime visitor count
pub async fn get_realtime(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<RealtimeResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    // Clean up old entries first
    sqlx::query("SELECT cleanup_analytics_realtime()")
        .execute(&state.pool)
        .await
        .ok();

    let visitors: Vec<RealtimeRow> = sqlx::query_as(
        r#"
        SELECT session_id, current_page, country_code, device_type, last_activity_at
        FROM analytics_realtime
        ORDER BY last_activity_at DESC
        LIMIT 100
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    let active_count = visitors.len() as i64;

    Ok(Json(RealtimeResponse {
        active_visitors: active_count,
        visitors: visitors.into_iter().map(|v| RealtimeVisitor {
            session_id: v.session_id,
            current_page: v.current_page.unwrap_or_default(),
            country_code: v.country_code,
            device_type: v.device_type,
            last_activity_at: v.last_activity_at,
        }).collect(),
    }))
}

/// Get analytics overview
pub async fn get_overview(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<AnalyticsOverview>> {
    require_admin(&state.pool, &auth_user).await?;

    // Exclude bots and admin visitors from stats for accurate counts
    let stats: (i64, i64, i64, i64, i64, Option<i64>) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(DISTINCT s.visitor_id)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= date_trunc('day', NOW())
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as visitors_today,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= date_trunc('day', NOW())
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as sessions_today,
            (SELECT COUNT(*)
             FROM analytics_page_views pv
             JOIN analytics_visitors v ON v.id = pv.visitor_id
             WHERE pv.entered_at >= date_trunc('day', NOW())
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as page_views_today,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= date_trunc('day', NOW())
               AND s.is_bounce = true
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as bounces_today,
            (SELECT COUNT(*)
             FROM analytics_realtime r
             JOIN analytics_visitors v ON v.id = r.visitor_id
             WHERE r.last_activity_at >= NOW() - interval '5 minutes'
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as visitors_now,
            (SELECT AVG(s.duration_seconds)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= date_trunc('day', NOW())
               AND s.duration_seconds IS NOT NULL
               AND v.is_bot = false
               AND v.is_admin = false)::bigint as avg_duration
        "#
    )
    .fetch_one(&state.pool)
    .await?;

    let bounce_rate = if stats.1 > 0 {
        (stats.3 as f64 / stats.1 as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(AnalyticsOverview {
        visitors_today: stats.0,
        sessions_today: stats.1,
        page_views_today: stats.2,
        bounce_rate,
        avg_session_duration_seconds: stats.5,
        visitors_now: stats.4,
    }))
}

/// Get top pages
pub async fn get_top_pages(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<TopPagesResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let limit = query.limit.unwrap_or(20).min(100);
    let (start, end, period_label) = parse_date_range(&query);

    let pages: Vec<TopPageRow> = sqlx::query_as(
        r#"
        SELECT
            pv.url_path,
            COUNT(*)::bigint as views,
            COUNT(DISTINCT pv.visitor_id)::bigint as visitors,
            AVG(pv.time_on_page_seconds)::bigint as avg_time_seconds
        FROM analytics_page_views pv
        JOIN analytics_visitors v ON v.id = pv.visitor_id
        WHERE pv.entered_at >= $1 AND pv.entered_at <= $2
          AND v.is_bot = false AND v.is_admin = false
        GROUP BY pv.url_path
        ORDER BY views DESC
        LIMIT $3
        "#
    )
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TopPagesResponse {
        pages: pages.into_iter().map(|p| TopPage {
            path: p.url_path,
            views: p.views,
            visitors: p.visitors,
            avg_time_seconds: p.avg_time_seconds,
        }).collect(),
        period: period_label,
    }))
}

/// Get traffic sources
pub async fn get_referrers(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<TrafficSourcesResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let limit = query.limit.unwrap_or(20).min(100);
    let (start, end, period_label) = parse_date_range(&query);

    let sources: Vec<SourceRow> = sqlx::query_as(
        r#"
        SELECT
            COALESCE(s.referrer_domain, 'direct') as source,
            COUNT(DISTINCT s.visitor_id)::bigint as visitors,
            COUNT(*)::bigint as sessions
        FROM analytics_sessions s
        JOIN analytics_visitors v ON v.id = s.visitor_id
        WHERE s.started_at >= $1 AND s.started_at <= $2
          AND v.is_bot = false AND v.is_admin = false
        GROUP BY COALESCE(s.referrer_domain, 'direct')
        ORDER BY visitors DESC
        LIMIT $3
        "#
    )
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TrafficSourcesResponse {
        sources: sources.into_iter().map(|s| TrafficSource {
            source: s.source.unwrap_or_else(|| "direct".to_string()),
            visitors: s.visitors,
            sessions: s.sessions,
        }).collect(),
        period: period_label,
    }))
}

/// Get device breakdown
pub async fn get_devices(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<DevicesResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let (start, end, _period_label) = parse_date_range(&query);

    let devices: Vec<DeviceRow> = sqlx::query_as(
        r#"
        SELECT
            s.device_type,
            COUNT(*)::bigint as count
        FROM analytics_sessions s
        JOIN analytics_visitors v ON v.id = s.visitor_id
        WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.device_type IS NOT NULL
          AND v.is_bot = false AND v.is_admin = false
        GROUP BY s.device_type
        ORDER BY count DESC
        "#
    )
    .bind(start)
    .bind(end)
    .fetch_all(&state.pool)
    .await?;

    let total: f64 = devices.iter().map(|d| d.count as f64).sum();

    Ok(Json(DevicesResponse {
        devices: devices.into_iter().map(|d| DeviceBreakdown {
            device_type: d.device_type.unwrap_or_else(|| "unknown".to_string()),
            count: d.count,
            percentage: if total > 0.0 { (d.count as f64 / total) * 100.0 } else { 0.0 },
        }).collect(),
    }))
}

/// Get location breakdown
pub async fn get_locations(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<LocationsResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let (start, end, _period_label) = parse_date_range(&query);

    let locations: Vec<LocationRow> = sqlx::query_as(
        r#"
        SELECT
            s.country_code,
            COUNT(DISTINCT s.visitor_id)::bigint as visitors
        FROM analytics_sessions s
        JOIN analytics_visitors v ON v.id = s.visitor_id
        WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.country_code IS NOT NULL
          AND v.is_bot = false AND v.is_admin = false
        GROUP BY s.country_code
        ORDER BY visitors DESC
        LIMIT 20
        "#
    )
    .bind(start)
    .bind(end)
    .fetch_all(&state.pool)
    .await?;

    let total: f64 = locations.iter().map(|l| l.visitors as f64).sum();

    Ok(Json(LocationsResponse {
        locations: locations.into_iter().map(|l| LocationEntry {
            country_code: l.country_code.unwrap_or_else(|| "XX".to_string()),
            visitors: l.visitors,
            percentage: if total > 0.0 { (l.visitors as f64 / total) * 100.0 } else { 0.0 },
        }).collect(),
    }))
}

// =============================================================================
// Timeseries and Enhanced Overview Endpoints
// =============================================================================

/// Timeseries data point
#[derive(Debug, Serialize)]
pub struct TimeseriesPoint {
    #[serde(with = "timestamp_format")]
    pub timestamp: OffsetDateTime,
    pub visitors: i64,
    pub sessions: i64,
    pub page_views: i64,
    pub bounces: i64,
}

#[derive(Debug, Serialize)]
pub struct TimeseriesResponse {
    pub data: Vec<TimeseriesPoint>,
    pub granularity: String,
}

#[derive(Debug, Deserialize)]
pub struct TimeseriesQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub granularity: Option<String>,
}

#[derive(Debug, FromRow)]
struct TimeseriesRow {
    timestamp: OffsetDateTime,
    visitors: i64,
    sessions: i64,
    page_views: i64,
    bounces: i64,
}

/// Get timeseries data for charts
pub async fn get_timeseries(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<TimeseriesQuery>,
) -> ApiResult<Json<TimeseriesResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let granularity = query.granularity.clone().unwrap_or_else(|| "daily".to_string());
    let now = OffsetDateTime::now_utc();

    // Parse dates or use defaults (last 30 days)
    let end = query.end.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(23, 59, 59).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(now);

    let start = query.start.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(0, 0, 0).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(end - time::Duration::days(30));

    let trunc = if granularity == "hourly" { "hour" } else { "day" };

    // Build query with format to avoid dynamic SQL issues
    // Include bot/admin filtering for consistent data across all analytics
    let sql = if trunc == "hour" {
        r#"
        WITH session_data AS (
            SELECT
                date_trunc('hour', s.started_at) as ts,
                s.visitor_id,
                s.is_bounce
            FROM analytics_sessions s
            JOIN analytics_visitors v ON v.id = s.visitor_id
            WHERE s.started_at >= $1 AND s.started_at <= $2
              AND v.is_bot = false AND v.is_admin = false
        ),
        pageview_data AS (
            SELECT
                date_trunc('hour', pv.entered_at) as ts,
                COUNT(*)::bigint as pv_count
            FROM analytics_page_views pv
            JOIN analytics_visitors v ON v.id = pv.visitor_id
            WHERE pv.entered_at >= $1 AND pv.entered_at <= $2
              AND v.is_bot = false AND v.is_admin = false
            GROUP BY date_trunc('hour', pv.entered_at)
        )
        SELECT
            sd.ts as timestamp,
            COUNT(DISTINCT sd.visitor_id)::bigint as visitors,
            COUNT(*)::bigint as sessions,
            COALESCE(MAX(pvd.pv_count), 0)::bigint as page_views,
            COUNT(*) FILTER (WHERE sd.is_bounce = true)::bigint as bounces
        FROM session_data sd
        LEFT JOIN pageview_data pvd ON sd.ts = pvd.ts
        GROUP BY sd.ts
        ORDER BY timestamp ASC
        "#
    } else {
        r#"
        WITH session_data AS (
            SELECT
                date_trunc('day', s.started_at) as ts,
                s.visitor_id,
                s.is_bounce
            FROM analytics_sessions s
            JOIN analytics_visitors v ON v.id = s.visitor_id
            WHERE s.started_at >= $1 AND s.started_at <= $2
              AND v.is_bot = false AND v.is_admin = false
        ),
        pageview_data AS (
            SELECT
                date_trunc('day', pv.entered_at) as ts,
                COUNT(*)::bigint as pv_count
            FROM analytics_page_views pv
            JOIN analytics_visitors v ON v.id = pv.visitor_id
            WHERE pv.entered_at >= $1 AND pv.entered_at <= $2
              AND v.is_bot = false AND v.is_admin = false
            GROUP BY date_trunc('day', pv.entered_at)
        )
        SELECT
            sd.ts as timestamp,
            COUNT(DISTINCT sd.visitor_id)::bigint as visitors,
            COUNT(*)::bigint as sessions,
            COALESCE(MAX(pvd.pv_count), 0)::bigint as page_views,
            COUNT(*) FILTER (WHERE sd.is_bounce = true)::bigint as bounces
        FROM session_data sd
        LEFT JOIN pageview_data pvd ON sd.ts = pvd.ts
        GROUP BY sd.ts
        ORDER BY timestamp ASC
        "#
    };

    let rows: Vec<TimeseriesRow> = sqlx::query_as(sql)
        .bind(start)
        .bind(end)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(TimeseriesResponse {
        data: rows.into_iter().map(|r| TimeseriesPoint {
            timestamp: r.timestamp,
            visitors: r.visitors,
            sessions: r.sessions,
            page_views: r.page_views,
            bounces: r.bounces,
        }).collect(),
        granularity,
    }))
}

/// Enhanced overview with period comparison
#[derive(Debug, Serialize)]
pub struct AnalyticsOverviewEnhanced {
    // Current period
    pub visitors: i64,
    pub sessions: i64,
    pub page_views: i64,
    pub views_per_visit: f64,
    pub bounce_rate: f64,
    pub avg_duration_seconds: Option<i64>,
    pub visitors_now: i64,
    // Previous period (for comparison)
    pub prev_visitors: i64,
    pub prev_sessions: i64,
    pub prev_page_views: i64,
    pub prev_views_per_visit: f64,
    pub prev_bounce_rate: f64,
    pub prev_avg_duration_seconds: Option<i64>,
    // Percentage changes
    pub visitors_change: f64,
    pub sessions_change: f64,
    pub page_views_change: f64,
    pub views_per_visit_change: f64,
    pub bounce_rate_change: f64,
    pub duration_change: f64,
}

/// Calculate percentage change
fn calc_change(current: f64, previous: f64) -> f64 {
    if previous == 0.0 {
        if current > 0.0 { 100.0 } else { 0.0 }
    } else {
        ((current - previous) / previous) * 100.0
    }
}

#[derive(Debug, FromRow)]
struct PeriodStatsRow {
    visitors: i64,
    sessions: i64,
    page_views: i64,
    bounces: i64,
    avg_duration: Option<i64>,
}

/// Get enhanced overview with comparison to previous period
pub async fn get_overview_enhanced(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<AnalyticsOverviewEnhanced>> {
    require_admin(&state.pool, &auth_user).await?;

    let now = OffsetDateTime::now_utc();

    // Parse dates or use defaults
    let end = query.end.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(23, 59, 59).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(now);

    let start = query.start.as_ref()
        .and_then(|s| time::Date::parse(s, time::macros::format_description!("[year]-[month]-[day]")).ok())
        .and_then(|d| d.with_hms(0, 0, 0).ok())
        .map(|dt| dt.assume_utc())
        .unwrap_or(now - time::Duration::days(30));

    // Calculate period duration for previous period
    let period_duration = end - start;
    let prev_end = start;
    let prev_start = prev_end - period_duration;

    // Get current period stats (excluding bots and admin visitors)
    let current: PeriodStatsRow = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(DISTINCT s.visitor_id)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as visitors,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as sessions,
            (SELECT COUNT(*)
             FROM analytics_page_views pv
             JOIN analytics_visitors v ON v.id = pv.visitor_id
             WHERE pv.entered_at >= $1 AND pv.entered_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as page_views,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.is_bounce = true
               AND v.is_bot = false AND v.is_admin = false)::bigint as bounces,
            (SELECT AVG(s.duration_seconds)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.duration_seconds IS NOT NULL
               AND v.is_bot = false AND v.is_admin = false)::bigint as avg_duration
        "#
    )
    .bind(start)
    .bind(end)
    .fetch_one(&state.pool)
    .await?;

    // Get previous period stats (excluding bots and admin visitors)
    let previous: PeriodStatsRow = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(DISTINCT s.visitor_id)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as visitors,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as sessions,
            (SELECT COUNT(*)
             FROM analytics_page_views pv
             JOIN analytics_visitors v ON v.id = pv.visitor_id
             WHERE pv.entered_at >= $1 AND pv.entered_at <= $2
               AND v.is_bot = false AND v.is_admin = false)::bigint as page_views,
            (SELECT COUNT(*)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.is_bounce = true
               AND v.is_bot = false AND v.is_admin = false)::bigint as bounces,
            (SELECT AVG(s.duration_seconds)
             FROM analytics_sessions s
             JOIN analytics_visitors v ON v.id = s.visitor_id
             WHERE s.started_at >= $1 AND s.started_at <= $2 AND s.duration_seconds IS NOT NULL
               AND v.is_bot = false AND v.is_admin = false)::bigint as avg_duration
        "#
    )
    .bind(prev_start)
    .bind(prev_end)
    .fetch_one(&state.pool)
    .await?;

    // Get realtime count (excluding bots and admin visitors)
    let visitors_now: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
        FROM analytics_realtime r
        JOIN analytics_visitors v ON v.id = r.visitor_id
        WHERE r.last_activity_at >= NOW() - interval '5 minutes'
          AND v.is_bot = false AND v.is_admin = false
        "#
    )
    .fetch_one(&state.pool)
    .await?;

    // Calculate metrics
    let views_per_visit = if current.sessions > 0 {
        current.page_views as f64 / current.sessions as f64
    } else {
        0.0
    };

    let prev_views_per_visit = if previous.sessions > 0 {
        previous.page_views as f64 / previous.sessions as f64
    } else {
        0.0
    };

    let bounce_rate = if current.sessions > 0 {
        (current.bounces as f64 / current.sessions as f64) * 100.0
    } else {
        0.0
    };

    let prev_bounce_rate = if previous.sessions > 0 {
        (previous.bounces as f64 / previous.sessions as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(AnalyticsOverviewEnhanced {
        visitors: current.visitors,
        sessions: current.sessions,
        page_views: current.page_views,
        views_per_visit,
        bounce_rate,
        avg_duration_seconds: current.avg_duration,
        visitors_now: visitors_now.0,
        prev_visitors: previous.visitors,
        prev_sessions: previous.sessions,
        prev_page_views: previous.page_views,
        prev_views_per_visit,
        prev_bounce_rate,
        prev_avg_duration_seconds: previous.avg_duration,
        visitors_change: calc_change(current.visitors as f64, previous.visitors as f64),
        sessions_change: calc_change(current.sessions as f64, previous.sessions as f64),
        page_views_change: calc_change(current.page_views as f64, previous.page_views as f64),
        views_per_visit_change: calc_change(views_per_visit, prev_views_per_visit),
        bounce_rate_change: calc_change(bounce_rate, prev_bounce_rate),
        duration_change: calc_change(
            current.avg_duration.unwrap_or(0) as f64,
            previous.avg_duration.unwrap_or(0) as f64
        ),
    }))
}

// =============================================================================
// Events, Goals, and Settings Endpoints
// =============================================================================

#[derive(Debug, Serialize)]
pub struct AnalyticsEvent {
    pub id: Uuid,
    pub event_name: String,
    pub event_category: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct EventsResponse {
    pub events: Vec<AnalyticsEvent>,
    pub period: String,
}

#[derive(Debug, FromRow)]
struct EventRow {
    event_name: String,
    event_category: Option<String>,
    count: i64,
}

/// Get custom events summary
pub async fn get_events(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<EventsResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let limit = query.limit.unwrap_or(50).min(100);
    let (start, end, period_label) = parse_date_range(&query);

    let events: Vec<EventRow> = sqlx::query_as(
        r#"
        SELECT
            e.event_name,
            e.event_category,
            COUNT(*)::bigint as count
        FROM analytics_events e
        JOIN analytics_visitors v ON v.id = e.visitor_id
        WHERE e.created_at >= $1 AND e.created_at <= $2
          AND v.is_bot = false AND v.is_admin = false
        GROUP BY e.event_name, e.event_category
        ORDER BY count DESC
        LIMIT $3
        "#
    )
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(EventsResponse {
        events: events.into_iter().map(|e| AnalyticsEvent {
            id: Uuid::new_v4(),
            event_name: e.event_name,
            event_category: e.event_category,
            count: e.count,
        }).collect(),
        period: period_label,
    }))
}

// Event details types
#[derive(Debug, Serialize)]
pub struct EventDetail {
    pub id: Uuid,
    pub event_name: String,
    pub event_category: Option<String>,
    pub event_data: Option<serde_json::Value>,
    pub page_url: Option<String>,
    #[serde(with = "timestamp_format")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct EventDetailsResponse {
    pub events: Vec<EventDetail>,
    pub total: i64,
}

#[derive(Debug, FromRow)]
struct EventDetailRow {
    id: Uuid,
    event_name: String,
    event_category: Option<String>,
    event_data: Option<serde_json::Value>,
    page_url: Option<String>,
    created_at: OffsetDateTime,
}

/// Get recent event details (individual events)
pub async fn get_event_details(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsQuery>,
) -> ApiResult<Json<EventDetailsResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let limit = query.limit.unwrap_or(50).min(100);
    let (start, end, _period_label) = parse_date_range(&query);

    let events: Vec<EventDetailRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.event_name, e.event_category, e.event_data, e.page_url, e.created_at
        FROM analytics_events e
        JOIN analytics_visitors v ON v.id = e.visitor_id
        WHERE e.created_at >= $1 AND e.created_at <= $2
          AND v.is_bot = false AND v.is_admin = false
        ORDER BY e.created_at DESC
        LIMIT $3
        "#
    )
    .bind(start)
    .bind(end)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
        FROM analytics_events e
        JOIN analytics_visitors v ON v.id = e.visitor_id
        WHERE e.created_at >= $1 AND e.created_at <= $2
          AND v.is_bot = false AND v.is_admin = false
        "#
    )
    .bind(start)
    .bind(end)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(EventDetailsResponse {
        events: events.into_iter().map(|e| EventDetail {
            id: e.id,
            event_name: e.event_name,
            event_category: e.event_category,
            event_data: e.event_data,
            page_url: e.page_url,
            created_at: e.created_at,
        }).collect(),
        total: total.0,
    }))
}

// Goal types
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Goal {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub event_name: Option<String>,
    pub url_pattern: Option<String>,
    pub goal_type: String,
    pub min_duration_seconds: Option<i32>,
    pub min_page_views: Option<i32>,
    pub is_active: bool,
    #[serde(with = "timestamp_format")]
    pub created_at: OffsetDateTime,
    #[serde(with = "timestamp_format")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct GoalsResponse {
    pub goals: Vec<Goal>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGoalRequest {
    pub name: String,
    pub description: Option<String>,
    pub event_name: Option<String>,
    pub url_pattern: Option<String>,
    pub goal_type: String,
    pub min_duration_seconds: Option<i32>,
    pub min_page_views: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGoalRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub event_name: Option<String>,
    pub url_pattern: Option<String>,
    pub goal_type: Option<String>,
    pub min_duration_seconds: Option<i32>,
    pub min_page_views: Option<i32>,
    pub is_active: Option<bool>,
}

/// List all analytics goals
pub async fn list_goals(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<GoalsResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let goals: Vec<Goal> = sqlx::query_as(
        r#"
        SELECT id, name, description, event_name, url_pattern, goal_type,
               min_duration_seconds, min_page_views, is_active, created_at, updated_at
        FROM analytics_goals
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(GoalsResponse { goals }))
}

/// Create a new analytics goal
pub async fn create_goal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateGoalRequest>,
) -> ApiResult<Json<Goal>> {
    require_admin(&state.pool, &auth_user).await?;

    let goal: Goal = sqlx::query_as(
        r#"
        INSERT INTO analytics_goals (name, description, event_name, url_pattern, goal_type, min_duration_seconds, min_page_views)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, description, event_name, url_pattern, goal_type,
                  min_duration_seconds, min_page_views, is_active, created_at, updated_at
        "#
    )
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.event_name)
    .bind(&req.url_pattern)
    .bind(&req.goal_type)
    .bind(req.min_duration_seconds)
    .bind(req.min_page_views)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(goal))
}

/// Update an analytics goal
pub async fn update_goal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(goal_id): axum::extract::Path<Uuid>,
    Json(req): Json<UpdateGoalRequest>,
) -> ApiResult<Json<Goal>> {
    require_admin(&state.pool, &auth_user).await?;

    let goal: Goal = sqlx::query_as(
        r#"
        UPDATE analytics_goals SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            event_name = COALESCE($4, event_name),
            url_pattern = COALESCE($5, url_pattern),
            goal_type = COALESCE($6, goal_type),
            min_duration_seconds = COALESCE($7, min_duration_seconds),
            min_page_views = COALESCE($8, min_page_views),
            is_active = COALESCE($9, is_active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, description, event_name, url_pattern, goal_type,
                  min_duration_seconds, min_page_views, is_active, created_at, updated_at
        "#
    )
    .bind(goal_id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.event_name)
    .bind(&req.url_pattern)
    .bind(&req.goal_type)
    .bind(req.min_duration_seconds)
    .bind(req.min_page_views)
    .bind(req.is_active)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(goal))
}

/// Delete an analytics goal
pub async fn delete_goal(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(goal_id): axum::extract::Path<Uuid>,
) -> ApiResult<StatusCode> {
    require_admin(&state.pool, &auth_user).await?;

    sqlx::query("DELETE FROM analytics_goals WHERE id = $1")
        .bind(goal_id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// Settings types
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AnalyticsSettings {
    pub id: Uuid,
    pub anonymize_ip: bool,
    pub collect_city: bool,
    pub respect_dnt: bool,
    pub cookie_consent_required: bool,
    pub raw_data_retention_days: i32,
    pub aggregate_retention_days: i32,
    pub enable_realtime: bool,
    pub realtime_max_visitors: i32,
    pub excluded_paths: Option<Vec<String>>,
    pub excluded_ips: Option<Vec<String>>,
    pub filter_bots: bool,
    #[serde(with = "timestamp_format")]
    pub created_at: OffsetDateTime,
    #[serde(with = "timestamp_format")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub anonymize_ip: Option<bool>,
    pub collect_city: Option<bool>,
    pub respect_dnt: Option<bool>,
    pub cookie_consent_required: Option<bool>,
    pub raw_data_retention_days: Option<i32>,
    pub aggregate_retention_days: Option<i32>,
    pub enable_realtime: Option<bool>,
    pub realtime_max_visitors: Option<i32>,
    pub excluded_paths: Option<Vec<String>>,
    pub excluded_ips: Option<Vec<String>>,
    pub filter_bots: Option<bool>,
}

/// Get analytics settings
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> ApiResult<Json<AnalyticsSettings>> {
    require_admin(&state.pool, &auth_user).await?;

    let settings: AnalyticsSettings = sqlx::query_as(
        r#"
        SELECT id, anonymize_ip, collect_city, respect_dnt, cookie_consent_required,
               raw_data_retention_days, aggregate_retention_days, enable_realtime,
               realtime_max_visitors, excluded_paths, excluded_ips, filter_bots,
               created_at, updated_at
        FROM analytics_settings
        LIMIT 1
        "#
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(settings))
}

/// Update analytics settings
pub async fn update_settings(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateSettingsRequest>,
) -> ApiResult<Json<AnalyticsSettings>> {
    require_admin(&state.pool, &auth_user).await?;

    let settings: AnalyticsSettings = sqlx::query_as(
        r#"
        UPDATE analytics_settings SET
            anonymize_ip = COALESCE($1, anonymize_ip),
            collect_city = COALESCE($2, collect_city),
            respect_dnt = COALESCE($3, respect_dnt),
            cookie_consent_required = COALESCE($4, cookie_consent_required),
            raw_data_retention_days = COALESCE($5, raw_data_retention_days),
            aggregate_retention_days = COALESCE($6, aggregate_retention_days),
            enable_realtime = COALESCE($7, enable_realtime),
            realtime_max_visitors = COALESCE($8, realtime_max_visitors),
            excluded_paths = COALESCE($9, excluded_paths),
            excluded_ips = COALESCE($10, excluded_ips),
            filter_bots = COALESCE($11, filter_bots),
            updated_at = NOW()
        RETURNING id, anonymize_ip, collect_city, respect_dnt, cookie_consent_required,
                  raw_data_retention_days, aggregate_retention_days, enable_realtime,
                  realtime_max_visitors, excluded_paths, excluded_ips, filter_bots,
                  created_at, updated_at
        "#
    )
    .bind(req.anonymize_ip)
    .bind(req.collect_city)
    .bind(req.respect_dnt)
    .bind(req.cookie_consent_required)
    .bind(req.raw_data_retention_days)
    .bind(req.aggregate_retention_days)
    .bind(req.enable_realtime)
    .bind(req.realtime_max_visitors)
    .bind(&req.excluded_paths)
    .bind(&req.excluded_ips)
    .bind(req.filter_bots)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(settings))
}

// =============================================================================
// Real-Time Alerts System
// =============================================================================

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Alert {
    pub id: Uuid,
    pub alert_type: String,
    pub severity: String,
    pub metric_name: String,
    pub current_value: i64,
    pub baseline_value: i64,
    pub threshold_multiplier: f64,
    #[serde(with = "timestamp_format")]
    pub triggered_at: OffsetDateTime,
    #[serde(with = "optional_timestamp_format", skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<OffsetDateTime>,
    pub is_resolved: bool,
    pub resolution_note: Option<String>,
    pub time_window_minutes: i32,
    pub alert_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct AlertsResponse {
    pub alerts: Vec<Alert>,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
pub struct ResolveAlertRequest {
    pub resolution_note: Option<String>,
}

/// Check for traffic spikes and create alerts if thresholds exceeded
async fn check_traffic_alerts(pool: &sqlx::PgPool) -> Result<bool, sqlx::Error> {
    // Get alert settings
    let row = sqlx::query(
        "SELECT alerts_enabled::text, alert_threshold_multiplier::text, alert_time_window_minutes::text FROM analytics_settings LIMIT 1"
    )
    .fetch_one(pool)
    .await?;

    // Parse values manually to avoid type issues
    let alerts_enabled_str: String = row.get(0);
    let threshold_str: String = row.get(1);
    let window_str: String = row.get(2);

    let alerts_enabled = alerts_enabled_str == "t" || alerts_enabled_str == "true";
    let threshold_multiplier = threshold_str.parse::<f64>().unwrap_or(5.0);
    let time_window_minutes = window_str.parse::<i32>().unwrap_or(5);

    if !alerts_enabled {
        return Ok(false);
    }

    // Calculate current visitors (in the alert time window)
    let current_visitors: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT visitor_id)::bigint
        FROM analytics_realtime
        WHERE last_activity_at > NOW() - MAKE_INTERVAL(mins => $1)
        "#
    )
    .bind(time_window_minutes)
    .fetch_one(pool)
    .await?;

    let current_value = current_visitors.0;

    // Calculate baseline: average visitors in the last hour (excluding current window)
    // Filter out bots and admins for accurate baseline
    let baseline_visitors: (Option<i64>,) = sqlx::query_as(
        r#"
        SELECT AVG(visitor_count)::bigint
        FROM (
            SELECT COUNT(DISTINCT s.visitor_id) as visitor_count
            FROM analytics_sessions s
            JOIN analytics_visitors v ON v.id = s.visitor_id
            WHERE s.started_at > NOW() - INTERVAL '1 hour'
              AND s.started_at < NOW() - ($1 || ' minutes')::INTERVAL
              AND v.is_bot = false AND v.is_admin = false
            GROUP BY date_trunc('minute', s.started_at)
        ) subq
        "#
    )
    .bind(time_window_minutes)
    .fetch_one(pool)
    .await?;

    let baseline_value = baseline_visitors.0.unwrap_or(1).max(1); // Avoid division by zero

    // Check if current traffic exceeds threshold
    if current_value as f64 > (baseline_value as f64 * threshold_multiplier) {
        // Check if we already have an unresolved alert for this spike
        let existing_alert: Option<(Uuid,)> = sqlx::query_as(
            r#"
            SELECT id FROM analytics_alerts
            WHERE alert_type = 'traffic_spike'
              AND is_resolved = false
              AND triggered_at > NOW() - INTERVAL '15 minutes'
            LIMIT 1
            "#
        )
        .fetch_optional(pool)
        .await?;

        if existing_alert.is_none() {
            // Create new alert
            let severity = if current_value as f64 > (baseline_value as f64 * threshold_multiplier * 2.0) {
                "high"
            } else if current_value as f64 > (baseline_value as f64 * threshold_multiplier * 1.5) {
                "medium"
            } else {
                "low"
            };

            sqlx::query(
                r#"
                INSERT INTO analytics_alerts (
                    alert_type, severity, metric_name,
                    current_value, baseline_value, threshold_multiplier,
                    time_window_minutes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                "#
            )
            .bind("traffic_spike")
            .bind(severity)
            .bind("visitors")
            .bind(current_value)
            .bind(baseline_value)
            .bind(threshold_multiplier)
            .bind(time_window_minutes)
            .execute(pool)
            .await?;

            return Ok(true);
        }
    }

    Ok(false)
}

/// Background task that periodically checks for traffic alerts
pub async fn alert_checker_task(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));

    loop {
        interval.tick().await;

        match check_traffic_alerts(&pool).await {
            Ok(alert_created) => {
                if alert_created {
                    tracing::info!("Traffic spike alert created");
                }
            }
            Err(e) => {
                tracing::error!("Error checking traffic alerts: {}", e);
            }
        }
    }
}

/// List all alerts (admin only)
pub async fn list_alerts(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<AlertsResponse>> {
    require_admin(&state.pool, &auth_user).await?;

    let is_resolved = params.get("is_resolved")
        .and_then(|v| v.parse::<bool>().ok());

    let limit: i64 = params.get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    let offset: i64 = params.get("offset")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let query = if let Some(resolved) = is_resolved {
        sqlx::query_as::<_, Alert>(
            r#"
            SELECT id, alert_type, severity, metric_name, current_value, baseline_value,
                   threshold_multiplier, triggered_at, resolved_at, is_resolved,
                   resolution_note, time_window_minutes, alert_data
            FROM analytics_alerts
            WHERE is_resolved = $1
            ORDER BY triggered_at DESC
            LIMIT $2 OFFSET $3
            "#
        )
        .bind(resolved)
        .bind(limit)
        .bind(offset)
    } else {
        sqlx::query_as::<_, Alert>(
            r#"
            SELECT id, alert_type, severity, metric_name, current_value, baseline_value,
                   threshold_multiplier, triggered_at, resolved_at, is_resolved,
                   resolution_note, time_window_minutes, alert_data
            FROM analytics_alerts
            ORDER BY triggered_at DESC
            LIMIT $1 OFFSET $2
            "#
        )
        .bind(limit)
        .bind(offset)
    };

    let alerts = query.fetch_all(&state.pool).await?;

    let total_query = if let Some(resolved) = is_resolved {
        sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*)::bigint FROM analytics_alerts WHERE is_resolved = $1"
        )
        .bind(resolved)
    } else {
        sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*)::bigint FROM analytics_alerts"
        )
    };

    let total: (i64,) = total_query.fetch_one(&state.pool).await?;

    Ok(Json(AlertsResponse {
        alerts,
        total: total.0,
    }))
}

/// Resolve an alert (admin only)
pub async fn resolve_alert(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(alert_id): axum::extract::Path<Uuid>,
    Json(req): Json<ResolveAlertRequest>,
) -> ApiResult<Json<Alert>> {
    require_admin(&state.pool, &auth_user).await?;

    let alert: Alert = sqlx::query_as(
        r#"
        UPDATE analytics_alerts
        SET is_resolved = true,
            resolved_at = NOW(),
            resolution_note = $2
        WHERE id = $1
        RETURNING *
        "#
    )
    .bind(alert_id)
    .bind(&req.resolution_note)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(alert))
}

//! Security Headers Middleware
//!
//! SOC 2 CC6.1: Adds security headers to all API responses to protect
//! against common web vulnerabilities.

use axum::{
    body::Body,
    http::{HeaderValue, Request, Response},
    middleware::Next,
};

/// Middleware that adds security headers to all responses
/// SOC 2 CC6.1: Defense-in-depth security headers
pub async fn security_headers_middleware(request: Request<Body>, next: Next) -> Response<Body> {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // X-Frame-Options: Prevent clickjacking attacks
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));

    // X-Content-Type-Options: Prevent MIME type sniffing
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );

    // X-XSS-Protection: Enable browser XSS filtering (legacy, but still useful)
    headers.insert(
        "X-XSS-Protection",
        HeaderValue::from_static("1; mode=block"),
    );

    // Referrer-Policy: Control referrer information leakage
    headers.insert(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // Permissions-Policy: Disable unused browser features
    headers.insert(
        "Permissions-Policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );

    // Strict-Transport-Security: Enforce HTTPS connections
    // SOC 2 CC6.1: Prevents man-in-the-middle attacks by requiring HTTPS
    headers.insert(
        "Strict-Transport-Security",
        HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
    );

    // Content-Security-Policy: Restrictive CSP for API responses
    // SOC 2 CC6.1: Prevents XSS if API response rendered as HTML
    headers.insert(
        "Content-Security-Policy",
        HeaderValue::from_static(
            "default-src 'none'; \
             frame-ancestors 'none'; \
             base-uri 'none'; \
             form-action 'none'; \
             upgrade-insecure-requests",
        ),
    );

    // Cache-Control: Prevent caching of sensitive API responses
    // Only add if not already set by the handler
    if !headers.contains_key("Cache-Control") {
        headers.insert(
            "Cache-Control",
            HeaderValue::from_static("no-store, no-cache, must-revalidate, private"),
        );
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router};
    use tower::ServiceExt;

    async fn test_handler() -> &'static str {
        "ok"
    }

    #[tokio::test]
    async fn test_security_headers_are_added() {
        let app = Router::new()
            .route("/", get(test_handler))
            .layer(axum::middleware::from_fn(security_headers_middleware));

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.headers().get("X-Frame-Options").unwrap(), "DENY");
        assert_eq!(
            response.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        assert_eq!(
            response.headers().get("X-XSS-Protection").unwrap(),
            "1; mode=block"
        );
        assert_eq!(
            response.headers().get("Referrer-Policy").unwrap(),
            "strict-origin-when-cross-origin"
        );
        assert_eq!(
            response.headers().get("Strict-Transport-Security").unwrap(),
            "max-age=63072000; includeSubDomains; preload"
        );
        assert!(
            response.headers().get("Content-Security-Policy").is_some(),
            "CSP header should be present"
        );
    }
}

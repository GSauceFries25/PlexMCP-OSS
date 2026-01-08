import type { NextConfig } from "next";

/**
 * SOC 2 CC6.1: Security headers to protect against common web vulnerabilities
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    // SOC 2 CC6.1: Content Security Policy to prevent XSS and data injection attacks
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // Note: Add your API domain here if using a separate API server (e.g., "https://api.yourdomain.com")
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        // Redirect /signup to /register
        source: "/signup",
        destination: "/register",
        permanent: true,
      },
      // Add pricing redirect if you have a marketing site:
      // {
      //   source: "/pricing",
      //   destination: "https://your-marketing-site.com/pricing",
      //   permanent: true,
      // },
    ];
  },
};

export default nextConfig;

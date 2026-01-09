import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for PlexMCP - learn how we protect your data and respect your privacy",
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Server className="h-6 w-6" />
            <span className="font-bold text-xl">PlexMCP</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Features
            </Link>
            <Link href="/#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/docs" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container py-12 max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Effective: January 9, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          {/* Introduction */}
          <section>
            <p className="text-muted-foreground">
              PlexMCP, Inc. (&quot;PlexMCP,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), based in San Francisco, CA, United States,
              is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose,
              and safeguard your information when you use our services.
            </p>
          </section>

          {/* 1. Information We Collect */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Information We Collect</h2>
            <p className="text-muted-foreground mb-4">We collect the following types of information:</p>

            <h3 className="text-lg font-medium mb-2">Account Information</h3>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li>Name and email address</li>
              <li>Organization name (if applicable)</li>
              <li>Password (stored securely using Argon2id hashing)</li>
            </ul>

            <h3 className="text-lg font-medium mb-2">Usage Data</h3>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li>API request counts and timestamps</li>
              <li>MCP server configurations and metadata</li>
              <li>Feature usage analytics</li>
            </ul>

            <h3 className="text-lg font-medium mb-2">Audit Logs</h3>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li>Authentication events</li>
              <li>Administrative actions</li>
              <li>Security-related activities</li>
            </ul>

            <div className="bg-muted/50 border rounded-lg p-4 mt-4">
              <p className="text-sm font-medium">Important:</p>
              <p className="text-sm text-muted-foreground">
                <strong>MCP request and response content is NOT stored</strong> by PlexMCP. We only proxy
                communications between your clients and MCP servers without retaining the content.
              </p>
            </div>
          </section>

          {/* 2. How We Use Information */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">2. How We Use Your Information</h2>
            <p className="text-muted-foreground mb-4">We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Provide, maintain, and improve our services</li>
              <li>Process transactions and send billing information</li>
              <li>Respond to customer support requests</li>
              <li>Monitor and analyze usage patterns to improve user experience</li>
              <li>Detect, prevent, and address security issues and fraud</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          {/* 3. Data Storage & Security */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Data Storage & Security</h2>
            <p className="text-muted-foreground mb-4">
              We implement industry-standard security measures to protect your data:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>Encryption in Transit:</strong> All data transmitted to and from our servers uses TLS 1.3</li>
              <li><strong>Encryption at Rest:</strong> Sensitive data is encrypted using AES-256</li>
              <li><strong>Access Control:</strong> Row-Level Security (RLS) ensures strict data isolation between organizations</li>
              <li><strong>Password Security:</strong> Passwords are hashed using Argon2id, the recommended algorithm for password hashing</li>
              <li><strong>Infrastructure:</strong> Our services are hosted on secure, SOC 2 compliant infrastructure</li>
            </ul>
          </section>

          {/* 4. Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Data Retention</h2>
            <p className="text-muted-foreground mb-4">We retain your data according to the following schedule:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>Active Accounts:</strong> Data is retained while your account remains active</li>
              <li><strong>Audit Logs:</strong> Retained for 7 years for compliance purposes</li>
              <li><strong>Backups:</strong> Operational backups retained for 30 days; archives retained for 1 year</li>
              <li><strong>Deleted Accounts:</strong> After you request deletion, your data enters a 30-day soft delete period (allowing recovery), after which it is permanently deleted</li>
            </ul>
          </section>

          {/* 5. Your Rights (GDPR) */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Your Rights</h2>
            <p className="text-muted-foreground mb-4">
              We comply with GDPR and provide you with the following rights:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>Right to Access (Article 15):</strong> You can export your data in JSON format through your account settings</li>
              <li><strong>Right to Erasure (Article 17):</strong> You can request deletion of your account, with a 30-day grace period during which the request can be cancelled</li>
              <li><strong>Right to Rectification:</strong> You can update your personal information through your account settings</li>
              <li><strong>Right to Data Portability:</strong> Your data export is provided in a portable JSON format</li>
              <li><strong>Right to Object:</strong> You can contact us to object to certain data processing activities</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              To exercise these rights, visit your account settings or contact{" "}
              <a href="mailto:support@plexmcp.com" className="text-primary hover:underline">
                support@plexmcp.com
              </a>.
            </p>
          </section>

          {/* 6. Data Breach Notification */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Data Breach Notification</h2>
            <p className="text-muted-foreground">
              In the event of a data breach affecting your personal data, we will notify you and
              relevant supervisory authorities within 72 hours of becoming aware of the breach,
              as required by GDPR Article 33.
            </p>
          </section>

          {/* 7. Third-Party Services */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Third-Party Services</h2>
            <p className="text-muted-foreground mb-4">
              We may use third-party services to help operate our platform. We ensure all third-party
              providers maintain appropriate security and privacy standards. Key points:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>We do not sell your personal data to third parties</li>
              <li>Third-party service providers only receive data necessary for their specific functions</li>
              <li>All providers are contractually bound to protect your data</li>
            </ul>
          </section>

          {/* 8. Cookies */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Cookies</h2>
            <p className="text-muted-foreground mb-4">We use cookies for the following purposes:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>Essential Cookies:</strong> Required for authentication and core functionality</li>
              <li><strong>Analytics:</strong> Privacy-focused, in-house analytics (no third-party tracking)</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              We do not use third-party tracking cookies or sell data to advertisers.
            </p>
          </section>

          {/* 9. Children's Privacy */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Children&apos;s Privacy</h2>
            <p className="text-muted-foreground">
              Our services are not intended for children under the age of 13. We do not knowingly
              collect personal information from children under 13. If you believe we have collected
              information from a child under 13, please contact us immediately at{" "}
              <a href="mailto:support@plexmcp.com" className="text-primary hover:underline">
                support@plexmcp.com
              </a>.
            </p>
          </section>

          {/* 10. International Data Transfers */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">10. International Data Transfers</h2>
            <p className="text-muted-foreground">
              Your data is processed and stored in the United States. If you are accessing our
              services from outside the United States, please be aware that your data will be
              transferred to, stored, and processed in the United States. We implement appropriate
              safeguards to ensure your data is protected in compliance with GDPR requirements.
            </p>
          </section>

          {/* 11. Changes to This Policy */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. Material changes will be
              communicated via email to your registered account address. The &quot;Effective&quot; date
              at the top of this policy indicates when it was last updated.
            </p>
          </section>

          {/* 12. Contact Information */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Contact Information</h2>
            <p className="text-muted-foreground mb-4">
              For questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Privacy Inquiries: <a href="mailto:support@plexmcp.com" className="text-primary hover:underline">support@plexmcp.com</a></li>
              <li>Security Concerns: <a href="mailto:security@plexmcp.com" className="text-primary hover:underline">security@plexmcp.com</a></li>
            </ul>
            <p className="text-muted-foreground mt-4">
              PlexMCP, Inc.<br />
              San Francisco, CA<br />
              United States
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 mt-auto">
        <div className="container flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} PlexMCP. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
            <Link href="/security" className="hover:text-foreground">Security</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

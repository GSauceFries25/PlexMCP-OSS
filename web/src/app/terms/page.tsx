import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for PlexMCP - the unified gateway for Model Context Protocol servers",
};

export default function TermsPage() {
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
        <h1 className="text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Effective: January 9, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          {/* Introduction */}
          <section>
            <p className="text-muted-foreground">
              Welcome to PlexMCP. These Terms of Service (&quot;Terms&quot;) govern your use of the PlexMCP
              platform and services provided by PlexMCP, Inc. (&quot;PlexMCP,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;),
              a company based in San Francisco, CA, United States.
            </p>
            <p className="text-muted-foreground">
              By accessing or using our services, you agree to be bound by these Terms. If you do not
              agree to these Terms, do not use our services.
            </p>
          </section>

          {/* 1. Account Terms */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Account Terms</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>You must be at least 18 years old or have the legal capacity to enter into a binding agreement.</li>
              <li>You must provide accurate and complete registration information.</li>
              <li>You are responsible for maintaining the security of your account, including your password and any two-factor authentication (2FA) credentials.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>One person or organization may not maintain more than one free account.</li>
            </ul>
          </section>

          {/* 2. Service Plans & Billing */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Service Plans & Billing</h2>
            <p className="text-muted-foreground mb-4">
              PlexMCP offers various service tiers with different features and usage limits:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>Free tier:</strong> 5 MCPs, 5 API connections, 1,000 requests per month</li>
              <li><strong>Pro plan:</strong> Overages billed at $0.50 per 1,000 additional requests</li>
              <li><strong>Team plan:</strong> Overages billed at $0.25 per 1,000 additional requests</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              For billing inquiries, contact us at{" "}
              <a href="mailto:billing@plexmcp.com" className="text-primary hover:underline">
                billing@plexmcp.com
              </a>.
            </p>
          </section>

          {/* 3. Acceptable Use */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Acceptable Use</h2>
            <p className="text-muted-foreground mb-4">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Use the service for any illegal purpose or in violation of any applicable laws</li>
              <li>Abuse or overload the service infrastructure beyond reasonable usage patterns</li>
              <li>Attempt to gain unauthorized access to the service or its related systems</li>
              <li>Use the software to provide a competing hosted MCP gateway service (as defined in our license)</li>
              <li>Interfere with or disrupt the integrity or performance of the service</li>
            </ul>
          </section>

          {/* 4. Intellectual Property & License */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Intellectual Property & License</h2>
            <p className="text-muted-foreground mb-4">
              PlexMCP is licensed under the Functional Source License, Version 1.1, Apache 2.0 Future License
              (FSL-1.1-Apache-2.0). Key terms include:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Self-hosting for your own organization&apos;s internal use is always permitted</li>
              <li>Organizations with annual revenue under $1,000,000 USD may use the software for commercial purposes</li>
              <li>Organizations exceeding $1,000,000 USD in annual revenue require a commercial license for commercial use</li>
              <li>On January 6, 2031, the license automatically converts to Apache License, Version 2.0</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              For commercial licensing inquiries, contact{" "}
              <a href="mailto:sales@plexmcp.com" className="text-primary hover:underline">
                sales@plexmcp.com
              </a>.
            </p>
          </section>

          {/* 5. Service Availability */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Service Availability</h2>
            <p className="text-muted-foreground mb-4">
              We strive to maintain high service availability:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Target uptime: 99.9% monthly availability</li>
              <li>Planned maintenance will be communicated in advance when possible</li>
              <li>Emergency maintenance may be performed without notice to protect service integrity</li>
            </ul>
          </section>

          {/* 6. Data Handling */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Data Handling</h2>
            <p className="text-muted-foreground mb-4">
              Your privacy is important to us:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong>MCP request and response content is NOT stored</strong> by PlexMCP</li>
              <li>We collect only the data necessary to provide and improve our services</li>
              <li>Usage metrics (request counts, timestamps) are retained for billing and analytics</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              For complete details, see our{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>.
            </p>
          </section>

          {/* 7. Security */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Security</h2>
            <p className="text-muted-foreground mb-4">
              We implement industry-standard security measures:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>JWT-based authentication with optional two-factor authentication (TOTP)</li>
              <li>TLS 1.3 encryption for all data in transit</li>
              <li>AES-256 encryption for data at rest</li>
              <li>Argon2id password hashing</li>
              <li>SOC 2 Type II compliance (target Q2 2026)</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              For more details, visit our{" "}
              <Link href="/security" className="text-primary hover:underline">
                Security page
              </Link>.
            </p>
          </section>

          {/* 8. Account Termination */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Account Termination</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>You may cancel your account at any time through your account settings</li>
              <li>Upon cancellation, your account enters a 30-day soft delete period during which you may recover your data</li>
              <li>After 30 days, your data is permanently deleted</li>
              <li>We may terminate or suspend your account for violations of these Terms</li>
              <li>Termination does not relieve you of any payment obligations incurred prior to termination</li>
            </ul>
          </section>

          {/* 9. Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, PLEXMCP SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR
              REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL,
              OR OTHER INTANGIBLE LOSSES RESULTING FROM YOUR USE OF THE SERVICE.
            </p>
          </section>

          {/* 10. Disclaimer of Warranties */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">10. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
              EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
          </section>

          {/* 11. Changes to Terms */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Changes to Terms</h2>
            <p className="text-muted-foreground">
              We may modify these Terms at any time. Material changes will be communicated via email
              to your registered account address. Your continued use of the service after such
              modifications constitutes acceptance of the updated Terms.
            </p>
          </section>

          {/* 12. Governing Law */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Governing Law</h2>
            <p className="text-muted-foreground">
              These Terms shall be governed by and construed in accordance with the laws of the
              State of California, United States, without regard to its conflict of law provisions.
            </p>
          </section>

          {/* 13. Contact Information */}
          <section>
            <h2 className="text-2xl font-semibold mb-4">13. Contact Information</h2>
            <p className="text-muted-foreground mb-4">
              For questions about these Terms, please contact us:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>General Support: <a href="mailto:support@plexmcp.com" className="text-primary hover:underline">support@plexmcp.com</a></li>
              <li>Billing: <a href="mailto:billing@plexmcp.com" className="text-primary hover:underline">billing@plexmcp.com</a></li>
              <li>Sales: <a href="mailto:sales@plexmcp.com" className="text-primary hover:underline">sales@plexmcp.com</a></li>
              <li>Security: <a href="mailto:security@plexmcp.com" className="text-primary hover:underline">security@plexmcp.com</a></li>
            </ul>
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

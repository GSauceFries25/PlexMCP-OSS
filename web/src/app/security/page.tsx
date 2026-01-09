import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Shield,
  Lock,
  Key,
  Eye,
  FileCheck,
  AlertTriangle,
  Mail,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security",
  description: "Learn about PlexMCP's security practices, compliance, and how we protect your data",
};

export default function SecurityPage() {
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

      {/* Hero Section */}
      <main className="container py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">Security</Badge>
            <h1 className="text-4xl font-bold tracking-tight mb-4">
              Security at PlexMCP
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              We take security seriously. Learn about the measures we implement to protect
              your data and keep your MCP connections secure.
            </p>
          </div>

          {/* Security Cards Grid */}
          <div className="grid gap-6 md:grid-cols-2 mb-12">
            {/* Infrastructure Security */}
            <Card>
              <CardHeader>
                <Lock className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Infrastructure Security</CardTitle>
                <CardDescription>Enterprise-grade encryption and isolation</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>TLS 1.3</strong> encryption for all data in transit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>AES-256</strong> encryption for data at rest</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Row-Level Security (RLS)</strong> for multi-tenant data isolation</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Authentication & Access */}
            <Card>
              <CardHeader>
                <Key className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Authentication & Access</CardTitle>
                <CardDescription>Strong authentication mechanisms</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>JWT-based</strong> authentication</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Two-factor authentication (TOTP)</strong> support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Argon2id</strong> password hashing</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Scoped API keys</strong> with granular permissions</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Data Protection */}
            <Card>
              <CardHeader>
                <Eye className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Data Protection</CardTitle>
                <CardDescription>Your data privacy is our priority</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>MCP content NOT stored</strong> - we only proxy, never retain</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Immutable audit logs</strong> with 7-year retention</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>Automatic backups</strong> with 30-day retention</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Compliance */}
            <Card>
              <CardHeader>
                <FileCheck className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Compliance</CardTitle>
                <CardDescription>Meeting industry standards</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>SOC 2 Type II</strong> compliance (target Q2 2026)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>GDPR compliant</strong> - data export, deletion, 72-hour breach notification</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span><strong>OWASP Top 10</strong> mitigations implemented</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Vulnerability Disclosure */}
          <Card className="mb-8">
            <CardHeader>
              <AlertTriangle className="h-8 w-8 mb-2 text-yellow-500" />
              <CardTitle>Vulnerability Disclosure</CardTitle>
              <CardDescription>
                We appreciate responsible security research
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                If you discover a security vulnerability in PlexMCP, we encourage you to report it
                responsibly. We commit to:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Acknowledging your report within 48 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Providing regular updates on our progress</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Following a 90+ day coordinated disclosure timeline</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span><strong>No legal action</strong> against researchers acting in good faith</span>
                </li>
              </ul>
              <div className="flex items-center gap-4 pt-4">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Report Security Issues</p>
                  <a
                    href="mailto:security@plexmcp.com"
                    className="text-sm text-primary hover:underline"
                  >
                    security@plexmcp.com
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact Section */}
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-4">Questions about our security practices?</h2>
            <p className="text-muted-foreground mb-6">
              Our security team is here to help. Reach out for more information about our
              security measures or to request our security documentation.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="mailto:security@plexmcp.com">
                <Button variant="outline" className="gap-2">
                  <Mail className="h-4 w-4" />
                  Contact Security Team
                </Button>
              </Link>
              <Link href="/privacy">
                <Button variant="ghost">View Privacy Policy</Button>
              </Link>
            </div>
          </div>
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

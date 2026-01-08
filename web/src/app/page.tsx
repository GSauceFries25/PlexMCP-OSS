import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OAuthHandler } from "@/components/oauth-handler";
import {
  Server,
  Key,
  Shield,
  Zap,
  Users,
  BarChart3,
  ArrowRight,
  Check,
  Github,
  Globe,
  Lock,
  BookOpen,
  ExternalLink,
  Twitter,
  MessageSquare,
} from "lucide-react";

const features = [
  {
    icon: Server,
    title: "Unified MCP Gateway",
    description: "Connect and manage all your Model Context Protocol servers from a single dashboard. Route requests seamlessly across multiple endpoints.",
  },
  {
    icon: Key,
    title: "API Key Management",
    description: "Generate, rotate, and revoke API keys with fine-grained permissions. Set expiration dates and scope-based access controls.",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description: "Built-in rate limiting, IP whitelisting, and audit logging. SOC 2 compliant infrastructure with end-to-end encryption.",
  },
  {
    icon: Zap,
    title: "High Performance",
    description: "Global edge network with sub-100ms latency. Automatic failover and load balancing across your MCP endpoints.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Role-based access control with owner, admin, member, and viewer roles. Invite team members and manage permissions.",
  },
  {
    icon: BarChart3,
    title: "Real-time Analytics",
    description: "Monitor API usage, track performance metrics, and set up alerts. Detailed insights into your MCP traffic patterns.",
  },
];

const pricingTiers = [
  {
    name: "Free",
    price: "$0",
    description: "For hobbyists and experimentation",
    features: [
      "Up to 5 MCPs",
      "5 API connections",
      "1,000 requests/month",
      "1 team member",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$29",
    description: "For growing teams and projects",
    features: [
      "Up to 20 MCPs",
      "20 API connections",
      "50,000 requests/month",
      "5 team members",
      "Priority support",
      "Advanced analytics",
    ],
    popular: true,
  },
  {
    name: "Team",
    price: "$99",
    description: "For organizations at scale",
    features: [
      "Up to 50 MCPs",
      "50 API connections",
      "250,000 requests/month",
      "Unlimited team members",
      "Priority support",
      "Audit logs",
      "99.5% SLA",
    ],
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* OAuth Handler - handles callback from Supabase on main domain */}
      <Suspense fallback={null}>
        <OAuthHandler />
      </Suspense>

      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="PlexMCP" width={28} height={28} />
            <span className="font-bold text-xl">PlexMCP</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Features
            </Link>
            <Link href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="https://docs.plexmcp.com" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link href="https://github.com/PlexMCP/plexmcp" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Open Source
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

      <main className="flex-1">
        {/* Hero Section */}
        <section className="container py-24 md:py-32 space-y-8">
          <div className="flex flex-col items-center text-center space-y-4 max-w-3xl mx-auto">
            <Badge variant="secondary" className="px-4 py-1">
              Now in Public Beta
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              The unified gateway for{" "}
              <span className="text-primary">Model Context Protocol</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl">
              Connect, manage, and scale your MCP servers with enterprise-grade security.
              One API key to rule them all.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link href="/register">
                <Button size="lg" className="gap-2">
                  Start for Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="https://docs.plexmcp.com">
                <Button size="lg" variant="outline" className="gap-2">
                  <BookOpen className="h-4 w-4" />
                  View Documentation
                </Button>
              </Link>
            </div>
          </div>

          {/* Hero Visual */}
          <div className="relative mx-auto max-w-5xl mt-16">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 blur-3xl opacity-30" />
            <Card className="relative border-2">
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col items-center p-6 rounded-lg bg-muted/50">
                    <Globe className="h-12 w-12 mb-4 text-primary" />
                    <div className="text-3xl font-bold">99.9%</div>
                    <div className="text-sm text-muted-foreground">Uptime SLA</div>
                  </div>
                  <div className="flex flex-col items-center p-6 rounded-lg bg-muted/50">
                    <Zap className="h-12 w-12 mb-4 text-primary" />
                    <div className="text-3xl font-bold">&lt;100ms</div>
                    <div className="text-sm text-muted-foreground">P99 Latency</div>
                  </div>
                  <div className="flex flex-col items-center p-6 rounded-lg bg-muted/50">
                    <Lock className="h-12 w-12 mb-4 text-primary" />
                    <div className="text-3xl font-bold">SOC 2</div>
                    <div className="text-sm text-muted-foreground">Compliant</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container py-24 space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to manage MCPs
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Built for developers who want to focus on building, not infrastructure.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="relative overflow-hidden">
                <CardHeader>
                  <feature.icon className="h-10 w-10 mb-2 text-primary" />
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="container py-24 space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Start free and scale as you grow. No hidden fees.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricingTiers.map((tier) => (
              <Card
                key={tier.name}
                className={`relative ${tier.popular ? "border-primary shadow-lg scale-105" : ""}`}
              >
                {tier.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle>{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                  <div className="pt-4">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" className="block">
                    <Button
                      className="w-full"
                      variant={tier.popular ? "default" : "outline"}
                    >
                      Get Started
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="container py-24">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="flex flex-col items-center text-center py-12 space-y-6">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Ready to get started?
              </h2>
              <p className="text-lg opacity-90 max-w-2xl">
                Join thousands of developers who are already using PlexMCP to manage their
                Model Context Protocol infrastructure.
              </p>
              <div className="flex gap-4">
                <Link href="/register">
                  <Button size="lg" variant="secondary">
                    Create Free Account
                  </Button>
                </Link>
                <Link href="https://docs.plexmcp.com">
                  <Button size="lg" variant="outline" className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground/10">
                    Read the Docs
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="flex items-center gap-2 mb-4">
                <Image src="/logo.svg" alt="PlexMCP" width={28} height={28} />
                <span className="font-bold text-xl">PlexMCP</span>
              </Link>
              <p className="text-sm text-muted-foreground">
                The unified gateway for Model Context Protocol servers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#features" className="hover:text-foreground">Features</Link></li>
                <li><Link href="#pricing" className="hover:text-foreground">Pricing</Link></li>
                <li><Link href="https://docs.plexmcp.com" className="hover:text-foreground">Documentation</Link></li>
                <li><Link href="/changelog" className="hover:text-foreground">Changelog</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/about" className="hover:text-foreground">About</Link></li>
                <li><Link href="/blog" className="hover:text-foreground">Blog</Link></li>
                <li><Link href="/careers" className="hover:text-foreground">Careers</Link></li>
                <li><Link href="/contact" className="hover:text-foreground">Contact</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Open Source</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="https://github.com/PlexMCP/plexmcp" target="_blank" rel="noopener noreferrer" className="hover:text-foreground flex items-center gap-1">PlexMCP <ExternalLink className="h-3 w-3" /></Link></li>
                <li><Link href="https://github.com/PlexMCP/plexmcp#readme" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Self-Host Guide</Link></li>
                <li><Link href="https://github.com/PlexMCP/plexmcp/discussions" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Community</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
                <li><Link href="/security" className="hover:text-foreground">Security</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-8 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} PlexMCP. All rights reserved.
            </p>
            <div className="flex gap-4">
              <Link href="https://github.com/plexmcp" className="text-muted-foreground hover:text-foreground">
                <Github className="h-5 w-5" />
              </Link>
              <Link href="https://x.com/plexmcp" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <Twitter className="h-5 w-5" />
              </Link>
              <Link href="https://discord.gg/HAYYTGnht8" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <MessageSquare className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

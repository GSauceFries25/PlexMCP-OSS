import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Server,
  Key,
  Zap,
  ArrowRight,
  Copy,
  Terminal,
  Github,
  ExternalLink,
  BookOpen,
  Code2,
  Settings,
  Users,
  Shield,
  Plug,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Learn how to use PlexMCP to manage your MCP servers",
};

const quickStartSteps = [
  {
    step: 1,
    title: "Create an Account",
    description: "Sign up for PlexMCP and create your first organization.",
    code: null,
  },
  {
    step: 2,
    title: "Generate an API Key",
    description: "Navigate to API Keys in your dashboard and create a new key.",
    code: null,
  },
  {
    step: 3,
    title: "Add MCP Servers",
    description: "Configure your MCP server endpoints in the MCPs section.",
    code: `{
  "name": "my-weather-mcp",
  "endpoint": "https://weather-mcp.example.com",
  "transport": "sse"
}`,
  },
  {
    step: 4,
    title: "Connect Your Client",
    description: "Use the configuration in your AI client to connect.",
    code: null,
  },
];

const apiEndpoints = [
  {
    method: "GET",
    path: "/v1/mcps",
    description: "List all MCP servers",
  },
  {
    method: "POST",
    path: "/v1/mcps",
    description: "Create a new MCP server",
  },
  {
    method: "GET",
    path: "/v1/mcps/:id",
    description: "Get MCP server details",
  },
  {
    method: "PUT",
    path: "/v1/mcps/:id",
    description: "Update MCP server",
  },
  {
    method: "DELETE",
    path: "/v1/mcps/:id",
    description: "Delete MCP server",
  },
  {
    method: "POST",
    path: "/v1/mcp/:id/tools/call",
    description: "Call a tool on an MCP server",
  },
];

const clientConfigs = {
  claude: `{
  "mcpServers": {
    "plexmcp": {
      "url": "https://api.plexmcp.com/mcp",
      "headers": {
        "X-API-Key": "YOUR_API_KEY"
      }
    }
  }
}`,
  vscode: `{
  "mcp": {
    "servers": {
      "plexmcp": {
        "type": "sse",
        "url": "https://api.plexmcp.com/mcp",
        "headers": {
          "X-API-Key": "YOUR_API_KEY"
        }
      }
    }
  }
}`,
  http: `curl -X POST https://api.plexmcp.com/v1/mcp/tools/call \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mcp_id": "your-mcp-id",
    "tool": "get_weather",
    "arguments": { "city": "San Francisco" }
  }'`,
};

export default function DocsPage() {
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
            <Link href="/docs" className="text-sm font-medium text-foreground transition-colors">
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

      <div className="container py-8 flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0">
          <nav className="sticky top-24 space-y-6">
            <div>
              <h4 className="font-semibold mb-2">Getting Started</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><a href="#overview" className="hover:text-foreground">Overview</a></li>
                <li><a href="#quickstart" className="hover:text-foreground">Quick Start</a></li>
                <li><a href="#authentication" className="hover:text-foreground">Authentication</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Guides</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><a href="#clients" className="hover:text-foreground">Client Integration</a></li>
                <li><a href="#mcps" className="hover:text-foreground">Managing MCPs</a></li>
                <li><a href="#teams" className="hover:text-foreground">Team Management</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">API Reference</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><a href="#api" className="hover:text-foreground">REST API</a></li>
                <li><a href="#webhooks" className="hover:text-foreground">Webhooks</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Resources</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>
                  <a href="https://github.com/AxonMCP/axonmcp" target="_blank" rel="noopener noreferrer" className="hover:text-foreground flex items-center gap-1">
                    Open Source (AxonMCP) <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li><a href="#changelog" className="hover:text-foreground">Changelog</a></li>
              </ul>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {/* Overview Section */}
          <section id="overview" className="mb-16">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="secondary">Documentation</Badge>
              <Badge variant="outline">v1.0</Badge>
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-4">
              PlexMCP Documentation
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-3xl">
              Learn how to connect, manage, and scale your Model Context Protocol (MCP) servers
              with PlexMCP. This documentation covers the hosted platform. For self-hosted
              deployments, see the{" "}
              <a
                href="https://github.com/AxonMCP/axonmcp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                AxonMCP open source project
              </a>
              .
            </p>

            <div className="grid gap-4 md:grid-cols-3 mb-8">
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <Zap className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle className="text-lg">Quick Start</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Get up and running in under 5 minutes</CardDescription>
                  <a href="#quickstart" className="text-sm text-primary hover:underline mt-2 inline-flex items-center gap-1">
                    Get Started <ArrowRight className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <Plug className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle className="text-lg">Client Integration</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Connect Claude, VS Code, and more</CardDescription>
                  <a href="#clients" className="text-sm text-primary hover:underline mt-2 inline-flex items-center gap-1">
                    View Clients <ArrowRight className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <Code2 className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle className="text-lg">API Reference</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Full REST API documentation</CardDescription>
                  <a href="#api" className="text-sm text-primary hover:underline mt-2 inline-flex items-center gap-1">
                    View API <ArrowRight className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
            </div>

            {/* Open Source Banner */}
            <Card className="bg-muted/50 border-dashed">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <Github className="h-8 w-8" />
                  <div>
                    <h3 className="font-semibold">Looking for self-hosted?</h3>
                    <p className="text-sm text-muted-foreground">
                      AxonMCP is the open source version you can deploy on your own infrastructure.
                    </p>
                  </div>
                </div>
                <a href="https://github.com/AxonMCP/axonmcp" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="gap-2">
                    <Github className="h-4 w-4" />
                    View on GitHub
                  </Button>
                </a>
              </CardContent>
            </Card>
          </section>

          {/* Quick Start Section */}
          <section id="quickstart" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Quick Start</h2>
            <p className="text-muted-foreground mb-8">
              Get your first MCP connection working in just a few steps.
            </p>

            <div className="space-y-6">
              {quickStartSteps.map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                    {item.step}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm mb-2">{item.description}</p>
                    {item.code && (
                      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                        <code>{item.code}</code>
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Authentication Section */}
          <section id="authentication" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Authentication</h2>
            <p className="text-muted-foreground mb-6">
              All API requests require authentication using an API key.
            </p>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Key Authentication
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Include your API key in the <code className="bg-muted px-1.5 py-0.5 rounded">Authorization</code> header:
                </p>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>Authorization: Bearer pk_live_xxxxxxxxxxxx</code>
                </pre>
              </CardContent>
            </Card>
          </section>

          {/* Client Integration Section */}
          <section id="clients" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Client Integration</h2>
            <p className="text-muted-foreground mb-6">
              Connect PlexMCP to your favorite AI tools and IDEs.
            </p>

            <Tabs defaultValue="claude" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                <TabsTrigger value="vscode">VS Code</TabsTrigger>
                <TabsTrigger value="http">HTTP/cURL</TabsTrigger>
              </TabsList>
              <TabsContent value="claude" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Claude Desktop Configuration</CardTitle>
                    <CardDescription>
                      Add this to your <code className="bg-muted px-1.5 py-0.5 rounded">claude_desktop_config.json</code>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                      <code>{clientConfigs.claude}</code>
                    </pre>
                    <p className="text-sm text-muted-foreground mt-4">
                      Config file location:
                    </p>
                    <ul className="text-sm text-muted-foreground list-disc list-inside mt-2">
                      <li>macOS: <code className="bg-muted px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                      <li>Windows: <code className="bg-muted px-1 rounded">%APPDATA%\Claude\claude_desktop_config.json</code></li>
                    </ul>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="vscode" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>VS Code Configuration</CardTitle>
                    <CardDescription>
                      Add this to your VS Code settings.json
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                      <code>{clientConfigs.vscode}</code>
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="http" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Direct HTTP/cURL</CardTitle>
                    <CardDescription>
                      Call MCP tools directly via REST API
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                      <code>{clientConfigs.http}</code>
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>

          {/* API Reference Section */}
          <section id="api" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">API Reference</h2>
            <p className="text-muted-foreground mb-6">
              Base URL: <code className="bg-muted px-1.5 py-0.5 rounded">https://api.plexmcp.com</code>
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Endpoints</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {apiEndpoints.map((endpoint) => (
                    <div key={endpoint.path} className="flex items-center gap-4 p-3 rounded-lg border">
                      <Badge
                        variant={endpoint.method === "GET" ? "secondary" : endpoint.method === "POST" ? "default" : endpoint.method === "DELETE" ? "destructive" : "outline"}
                        className="w-16 justify-center"
                      >
                        {endpoint.method}
                      </Badge>
                      <code className="text-sm font-mono">{endpoint.path}</code>
                      <span className="text-sm text-muted-foreground ml-auto">{endpoint.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Team Management Section */}
          <section id="teams" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Team Management</h2>
            <p className="text-muted-foreground mb-6">
              PlexMCP supports team collaboration with role-based access control.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <Users className="h-6 w-6 mb-2 text-primary" />
                  <CardTitle>Roles</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li><strong>Owner</strong> - Full access, billing management</li>
                    <li><strong>Admin</strong> - Manage MCPs, API keys, and members</li>
                    <li><strong>Member</strong> - Use MCPs, view analytics</li>
                    <li><strong>Viewer</strong> - Read-only access</li>
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Shield className="h-6 w-6 mb-2 text-primary" />
                  <CardTitle>Security</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li>SSO/SAML support (Team & Enterprise)</li>
                    <li>Audit logging</li>
                    <li>IP allowlisting</li>
                    <li>API key rotation</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Resources Section */}
          <section id="resources" className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Additional Resources</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <a href="https://github.com/AxonMCP/axonmcp" target="_blank" rel="noopener noreferrer">
                <Card className="hover:border-primary/50 transition-colors h-full">
                  <CardContent className="flex items-center gap-4 pt-6">
                    <Github className="h-10 w-10" />
                    <div>
                      <h3 className="font-semibold">AxonMCP (Open Source)</h3>
                      <p className="text-sm text-muted-foreground">
                        Self-host your own MCP gateway with the open source version.
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </CardContent>
                </Card>
              </a>
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
                <Card className="hover:border-primary/50 transition-colors h-full">
                  <CardContent className="flex items-center gap-4 pt-6">
                    <BookOpen className="h-10 w-10" />
                    <div>
                      <h3 className="font-semibold">MCP Specification</h3>
                      <p className="text-sm text-muted-foreground">
                        Learn about the Model Context Protocol specification.
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </CardContent>
                </Card>
              </a>
            </div>
          </section>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t py-8 mt-auto">
        <div className="container flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            &copy; 2025 PlexMCP. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link href="https://github.com/AxonMCP/axonmcp" className="text-muted-foreground hover:text-foreground">
              <Github className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

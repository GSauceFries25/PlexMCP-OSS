"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  MessageSquare,
  BookOpen,
  Ticket,
  ChevronDown,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFAQFeedback } from "@/lib/api/hooks";
import { FAQ_CATEGORY_LABELS } from "@/types/support";
import type { FAQArticle } from "@/types/support";

// Static FAQ data for when API is not available
const STATIC_FAQS: FAQArticle[] = [
  {
    id: "1",
    title: "How do I create my first MCP?",
    content: `To create your first MCP:
1. Go to the MCPs page in your dashboard
2. Click "Add MCP"
3. Enter your MCP server URL (e.g., http://localhost:3000/mcp)
4. Give it a name and optional description
5. Click "Create"

Your MCP will be automatically tested to ensure it's reachable.`,
    category: "getting-started",
    search_keywords: ["create", "first", "mcp", "add", "new", "start"],
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    is_published: true,
    display_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "2",
    title: "How do I connect an AI client?",
    content: `To connect an AI client (Claude Desktop, Cursor, etc.):
1. Go to the Connections page
2. Select your AI client type
3. Choose which MCPs to include
4. Generate the configuration
5. Copy the config to your client settings file

Each client has specific instructions shown during the generation process.`,
    category: "getting-started",
    search_keywords: ["connect", "client", "claude", "cursor", "ai"],
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    is_published: true,
    display_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "3",
    title: "How does billing work?",
    content: `PlexMCP offers several plans:
- **Free**: 5 MCPs, 1,000 calls/month, 1 team member
- **Pro** ($29/mo): 20 MCPs, 50,000 calls/month, 5 team members (+$0.50/1K overage)
- **Team** ($99/mo): 50 MCPs, 250,000 calls/month, unlimited team members (+$0.25/1K overage)
- **Enterprise**: Custom limits, SSO/SAML, dedicated support

Paid plans include overage billing when you exceed your monthly API call limit.`,
    category: "billing",
    search_keywords: ["billing", "payment", "subscription", "plan", "price"],
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    is_published: true,
    display_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "4",
    title: "Why is my MCP showing as unhealthy?",
    content: `An unhealthy MCP status usually means:
1. **Connection refused**: MCP server is not running
2. **Timeout**: Server is slow or unreachable
3. **Authentication failed**: Invalid credentials
4. **SSL error**: Certificate issues

Check the Testing page for detailed error messages and run a manual health check.`,
    category: "technical",
    search_keywords: ["unhealthy", "error", "connection", "failed", "timeout"],
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    is_published: true,
    display_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "5",
    title: "My AI client can't connect to PlexMCP",
    content: `If your AI client can't connect:
1. Verify the API key is correct and not revoked
2. Check the server URL matches your client config
3. Ensure the client type in config matches your tool
4. Try regenerating the configuration
5. Restart your AI client after config changes

Test your connection in the Testing page first.`,
    category: "troubleshooting",
    search_keywords: ["client", "connect", "fail", "cannot", "error"],
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    is_published: true,
    display_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Support channel cards
const SUPPORT_CHANNELS = [
  {
    icon: MessageSquare,
    title: "Discord Community",
    description: "Get help from the community and PlexMCP team",
    href: "https://discord.gg/HAYYTGnht8",
    external: true,
  },
  {
    icon: BookOpen,
    title: "Documentation",
    description: "Read our comprehensive guides and API docs",
    href: "https://docs.plexmcp.com",
    external: true,
  },
  {
    icon: Ticket,
    title: "Submit a Ticket",
    description: "Create a support ticket for direct assistance",
    href: "/support/new",
    external: false,
  },
];

// FAQ Accordion Item
function FAQItem({ article, onFeedback }: { article: FAQArticle; onFeedback?: (helpful: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<"helpful" | "not-helpful" | null>(null);

  const handleFeedback = (helpful: boolean) => {
    setFeedbackGiven(helpful ? "helpful" : "not-helpful");
    onFeedback?.(helpful);
  };

  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800 last:border-0">
      <button
        className="flex w-full items-center justify-between py-4 text-left hover:text-neutral-600 dark:hover:text-neutral-300"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{article.title}</span>
        {isOpen ? (
          <ChevronDown className="h-5 w-5 text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight className="h-5 w-5 text-neutral-500 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="pb-4 space-y-4">
          <div className="prose prose-sm dark:prose-invert max-w-none text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
            {article.content}
          </div>
          {!feedbackGiven ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span>Was this helpful?</span>
              <Button variant="ghost" size="sm" onClick={() => handleFeedback(true)}>
                <ThumbsUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleFeedback(false)}>
                <ThumbsDown className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              {feedbackGiven === "helpful" ? "Thanks for the feedback!" : "Sorry to hear that. Consider submitting a ticket for more help."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Category Section
function FAQCategory({ category, articles, onFeedback }: { category: string; articles: FAQArticle[]; onFeedback?: (articleId: string, helpful: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const label = FAQ_CATEGORY_LABELS[category] || category;

  return (
    <div className="mb-6">
      <button
        className="flex w-full items-center gap-2 py-2 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-5 w-5 text-neutral-500" />
        ) : (
          <ChevronRight className="h-5 w-5 text-neutral-500" />
        )}
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{label}</h3>
        <span className="text-sm text-neutral-500">({articles.length})</span>
      </button>
      {isOpen && (
        <div className="pl-7 mt-2">
          {articles.map((article) => (
            <FAQItem
              key={article.id}
              article={article}
              onFeedback={(helpful) => onFeedback?.(article.id, helpful)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const faqFeedback = useFAQFeedback();

  // Use static FAQs - API endpoints not implemented yet
  const allFaqs = STATIC_FAQS;
  const isSearching = searchQuery.length >= 2;

  // Client-side search on static FAQs
  const displayFaqs = isSearching
    ? allFaqs.filter((faq) => {
        const query = searchQuery.toLowerCase();
        return (
          faq.title.toLowerCase().includes(query) ||
          faq.content.toLowerCase().includes(query) ||
          faq.search_keywords?.some((kw) => kw.toLowerCase().includes(query))
        );
      })
    : allFaqs;
  const isLoading = false;

  // Group FAQs by category
  const groupedFaqs = (displayFaqs ?? []).reduce((acc, faq) => {
    const category = faq.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(faq);
    return acc;
  }, {} as Record<string, FAQArticle[]>);

  const handleFeedback = (articleId: string, helpful: boolean) => {
    faqFeedback.mutate({ articleId, helpful });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Help Center
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          Find answers to common questions or get in touch with our support team
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
        <Input
          placeholder="Search for help..."
          className="pl-10 h-12 text-base"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Support Channels */}
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          Get Support
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SUPPORT_CHANNELS.map((channel) => (
            <Card key={channel.title} className="hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
              <Link href={channel.href} target={channel.external ? "_blank" : undefined}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                      <channel.icon className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
                    </div>
                    <div className="flex items-center gap-1">
                      <CardTitle className="text-base">{channel.title}</CardTitle>
                      {channel.external && <ExternalLink className="h-3 w-3 text-neutral-400" />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{channel.description}</CardDescription>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      </div>

      {/* FAQ Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {isSearching ? "Search Results" : "Frequently Asked Questions"}
          </h2>
          {isSearching && displayFaqs.length === 0 && (
            <Link href="/support/new">
              <Button variant="outline" size="sm">
                <Ticket className="h-4 w-4 mr-2" />
                Submit a Ticket
              </Button>
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isSearching && displayFaqs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
              <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                No results found
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                We couldn&apos;t find any articles matching &quot;{searchQuery}&quot;
              </p>
              <Link href="/support/new">
                <Button>
                  <Ticket className="h-4 w-4 mr-2" />
                  Submit a Support Ticket
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-4">
              {isSearching ? (
                // Show flat list for search results
                <div>
                  {displayFaqs.map((article) => (
                    <FAQItem
                      key={article.id}
                      article={article}
                      onFeedback={(helpful) => handleFeedback(article.id, helpful)}
                    />
                  ))}
                </div>
              ) : (
                // Show categorized FAQs
                Object.entries(groupedFaqs).map(([category, articles]) => (
                  <FAQCategory
                    key={category}
                    category={category}
                    articles={articles}
                    onFeedback={handleFeedback}
                  />
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Contact Section */}
      <Card className="bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
        <CardContent className="py-8 text-center">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Still need help?
          </h3>
          <p className="text-neutral-500 dark:text-neutral-400 mb-4">
            Our support team is here to assist you with any questions or issues.
          </p>
          <div className="flex justify-center gap-4">
            <Link href="/support/new">
              <Button>
                <Ticket className="h-4 w-4 mr-2" />
                Submit a Ticket
              </Button>
            </Link>
            <Link href="/support">
              <Button variant="outline">View My Tickets</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/providers/theme-provider";
import { QueryProvider } from "@/providers/query-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { ClientToaster } from "@/components/ui/client-toaster";
import { HydrationBoundary } from "@/components/hydration-boundary";
import { ConsoleEasterEgg } from "@/components/console-easter-egg";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PlexMCP - MCP Gateway",
    template: "%s | PlexMCP",
  },
  description:
    "Deploy, manage, and scale your Model Context Protocol (MCP) servers with PlexMCP. Enterprise-grade MCP infrastructure for AI applications.",
  keywords: [
    "MCP",
    "Model Context Protocol",
    "AI infrastructure",
    "MCP gateway",
    "MCP platform",
    "AI tools",
    "Claude",
    "Anthropic",
  ],
  authors: [{ name: "PlexMCP" }],
  creator: "PlexMCP",
  icons: {
    icon: [
      { url: "/favicon.svg?v=2", type: "image/svg+xml" },
      { url: "/favicon.ico?v=2", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png?v=2",
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "PlexMCP",
    title: "PlexMCP - MCP Gateway",
    description:
      "Deploy, manage, and scale your Model Context Protocol (MCP) servers with PlexMCP.",
  },
  twitter: {
    card: "summary_large_image",
    site: "@plexmcp",
    creator: "@plexmcp",
    title: "PlexMCP - MCP Gateway",
    description:
      "Deploy, manage, and scale your Model Context Protocol (MCP) servers with PlexMCP.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
        suppressHydrationWarning
      >
        <HydrationBoundary>
          <ThemeProvider>
            <QueryProvider>
              <AuthProvider>
                {children}
                <ClientToaster />
                <ConsoleEasterEgg />
              </AuthProvider>
            </QueryProvider>
          </ThemeProvider>
        </HydrationBoundary>
        {/* In-house analytics - privacy-focused, no third-party tracking */}
        {process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true" && (
          <Script src="/analytics.js" strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}

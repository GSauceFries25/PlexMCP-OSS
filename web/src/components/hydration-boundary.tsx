"use client";

import { useEffect, useState, type ReactNode } from "react";

interface HydrationBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * HydrationBoundary component that suppresses hydration mismatches
 * by only rendering children after the component has mounted on the client.
 *
 * This is a "nuclear option" for fixing persistent hydration errors that
 * come from third-party libraries or subtle timing issues.
 *
 * On initial server render: renders fallback (or children with suppressHydrationWarning)
 * On client after mount: renders children normally
 */
export function HydrationBoundary({ children, fallback }: HydrationBoundaryProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // If no fallback provided, render children with suppressHydrationWarning
  // This allows the page to render during SSR while suppressing mismatches
  if (!mounted) {
    return (
      <div suppressHydrationWarning>
        {fallback ?? children}
      </div>
    );
  }

  return <>{children}</>;
}

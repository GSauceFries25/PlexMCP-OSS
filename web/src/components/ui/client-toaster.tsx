"use client";

import dynamic from "next/dynamic";

// Dynamically import Toaster with SSR disabled to prevent hydration mismatch
// The Toaster uses useTheme() which returns different values on server vs client
const Toaster = dynamic(
  () => import("@/components/ui/sonner").then((mod) => mod.Toaster),
  { ssr: false }
);

export function ClientToaster() {
  return <Toaster />;
}

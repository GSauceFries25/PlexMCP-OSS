"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

const pathNameMap: Record<string, string> = {
  dashboard: "Dashboard",
  mcps: "MCPs",
  "api-keys": "API Keys",
  usage: "Usage & Analytics",
  team: "Team Members",
  billing: "Billing",
  settings: "Settings",
  support: "Help & Support",
  admin: "Admin Panel",
  users: "Users",
  organizations: "Organizations",
  stats: "Platform Stats",
  "audit-logs": "Audit Logs",
};

export function DashboardHeader() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);

    return segments.map((segment, index) => {
      const path = "/" + segments.slice(0, index + 1).join("/");
      const isLast = index === segments.length - 1;
      const label = pathNameMap[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

      return {
        label,
        path,
        isLast,
      };
    });
  }, [pathname]);

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((crumb, index) => (
            <BreadcrumbItem key={crumb.path}>
              {crumb.isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink href={crumb.path}>{crumb.label}</BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

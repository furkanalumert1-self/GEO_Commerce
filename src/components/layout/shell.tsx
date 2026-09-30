import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import { MobileNav, NavLinks, type NavItem } from "./nav-client";
import { ContextSwitcher } from "./context-switcher";
import { SignOutButton } from "./sign-out";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: string;
  isDemo: boolean;
  planKey: string;
  brands: Array<{ id: string; name: string; domain: string }>;
}

const BRAND_NAV: Array<[MessageKey, string]> = [
  ["nav.dashboard", "dashboard"],
  ["nav.catalog", "catalog"],
  ["nav.prompts", "prompts"],
  ["nav.visibility", "visibility"],
  ["nav.competitors", "competitors"],
  ["nav.citations", "citations"],
  ["nav.opportunities", "opportunities"],
  ["nav.actions", "actions"],
  ["nav.revenue", "revenue"],
  ["nav.ads", "ads"],
  ["nav.integrations", "integrations"],
  ["nav.reports", "reports"],
];

export function buildNav(ws: ShellWorkspace, brandId: string | null): Array<{ heading: string; items: NavItem[] }> {
  const W = `/w/${ws.id}`;
  const groups: Array<{ heading: string; items: NavItem[] }> = [];
  if (brandId) {
    groups.push({ heading: t("nav.brand"), items: BRAND_NAV.map(([k, p]) => ({ label: t(k), href: `${W}/b/${brandId}/${p}` })) });
  }
  const wsItems: NavItem[] = [{ label: t("nav.overview"), href: `${W}/overview` }];
  if (ws.planKey === "agency" || ws.planKey === "enterprise") wsItems.push({ label: t("nav.clients"), href: `${W}/clients` });
  wsItems.push({ label: t("nav.onboarding"), href: `${W}/onboarding` });
  if (ws.role === "owner" || ws.role === "admin" || ws.role === "billing") wsItems.push({ label: t("nav.billing"), href: `${W}/billing` });
  wsItems.push({ label: t("nav.notifications"), href: `${W}/notifications` });
  if (ws.role === "owner" || ws.role === "admin") wsItems.push({ label: t("nav.settings"), href: `${W}/settings` });
  groups.push({ heading: t("nav.workspace"), items: wsItems });
  return groups;
}

export function AppShell({
  workspaces,
  current,
  brandId,
  user,
  children,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  brandId: string | null;
  user: { email: string; name: string | null };
  children: ReactNode;
}) {
  const nav = buildNav(current, brandId);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t("common.skip")}
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-surface lg:flex" aria-label="Ana gezinme">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href={`/w/${current.id}/overview`} className="font-semibold">Callypso AI Growth</Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <NavLinks groups={nav} />
        </nav>
        <div className="border-t border-border px-4 py-3 text-xs text-muted">
          <p className="truncate" title={user.email}>{user.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 sm:px-6">
          <MobileNav groups={nav} />
          <Suspense fallback={<div className="flex-1" />}>
            <ContextSwitcher workspaces={workspaces} currentWorkspaceId={current.id} currentBrandId={brandId} />
          </Suspense>
          {current.isDemo ? <Badge tone="warning">{t("common.demoData")}</Badge> : null}
          <div className="lg:hidden">
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

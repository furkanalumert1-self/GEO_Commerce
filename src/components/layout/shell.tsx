import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import { MobileNav, SidebarNav, type NavEntry, type NavModel } from "./nav-client";
import { ContextSwitcher } from "./context-switcher";
import { SignOutButton } from "./sign-out";
import { APP_NAME } from "@/lib/brand";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: string;
  isDemo: boolean;
  planKey: string;
  brands: Array<{ id: string; name: string; domain: string }>;
}

/**
 * Bilgi mimarisi: Genel Bakış · AI Görünürlüğü · Büyüme Fırsatları · Satış & Reklam · Raporlar; altta Ayarlar ve hesap.
 * Route'lar değişmedi; yalnız gruplama ve etiketler. En çok iki seviye.
 */
export function buildNav(ws: ShellWorkspace, brandId: string | null): NavModel {
  const W = `/w/${ws.id}`;
  const canBilling = ws.role === "owner" || ws.role === "admin" || ws.role === "billing";
  const canSettings = ws.role === "owner" || ws.role === "admin";
  const main: NavEntry[] = [];

  if (brandId) {
    const B = `${W}/b/${brandId}`;
    main.push(
      { kind: "link", label: "Genel Bakış", href: `${B}/dashboard`, icon: "overview" },
      {
        kind: "group",
        id: "visibility",
        label: "AI Görünürlüğü",
        icon: "visibility",
        items: [
          { label: "Sorular", href: `${B}/visibility`, match: [`${B}/prompts`, `${B}/runs`] },
          { label: "Rakipler", href: `${B}/competitors` },
          { label: "Kaynaklar", href: `${B}/citations` },
        ],
      },
      {
        kind: "group",
        id: "growth",
        label: "Büyüme Fırsatları",
        icon: "growth",
        items: [
          { label: "Fırsatlar", href: `${B}/opportunities` },
          { label: "Aksiyonlar", href: `${B}/actions` },
        ],
      },
      {
        kind: "group",
        id: "sales",
        label: "Satış & Reklam",
        icon: "sales",
        items: [
          { label: "Gelir", href: `${B}/revenue` },
          { label: "Reklamlar", href: `${B}/ads` },
        ],
      },
      { kind: "link", label: "Raporlar", href: `${B}/reports`, icon: "reports" },
    );
  }

  // Çalışma alanı düzeyi: marka portföyü, ajans müşterileri, kurulum, bildirimler.
  main.push({ kind: "link", label: brandId ? "Tüm markalar" : "Genel Bakış", href: `${W}/overview`, icon: "portfolio" });
  if (ws.planKey === "agency" || ws.planKey === "enterprise") main.push({ kind: "link", label: t("nav.clients"), href: `${W}/clients`, icon: "clients" });
  main.push({ kind: "link", label: t("nav.notifications"), href: `${W}/notifications`, icon: "notifications" });

  const settingsItems = [
    ...(brandId
      ? [
          { label: "Katalog", href: `${W}/b/${brandId}/catalog` },
          { label: "Entegrasyon", href: `${W}/b/${brandId}/integrations` },
        ]
      : []),
    ...(canSettings ? [{ label: "Ekip", href: `${W}/settings?tab=members`, match: [`${W}/settings`] }] : []),
    ...(canBilling ? [{ label: "Abonelik", href: `${W}/billing` }] : []),
    { label: "Kurulum", href: `${W}/onboarding` },
  ];
  const bottom: NavEntry[] = [{ kind: "group", id: "settings", label: "Ayarlar", icon: "settings", items: settingsItems }];
  return { main, bottom };
}

function Account({ email, plan }: { email: string; plan?: string }) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-3 rounded-[14px] border border-border p-2.5 text-xs text-text-secondary">
        <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-sm font-semibold text-text">{email.charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-medium text-text" title={email}>{email}</p>
          {plan ? <p className="truncate">{plan}</p> : null}
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}

const PLAN_LABEL: Record<string, string> = { free_audit: "Ücretsiz", starter: "Starter", growth: "Growth", commerce: "Commerce", agency: "Agency", enterprise: "Enterprise" };

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
  const brand = (
    <Link href={`/w/${current.id}/overview`} className="flex items-center gap-2 rounded-md font-semibold tracking-[-0.01em]">
      <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary text-sm font-bold text-white">C</span>
      <span>{APP_NAME}</span>
    </Link>
  );
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t("common.skip")}
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] flex-col border-r border-border bg-surface lg:flex" aria-label="Kenar çubuğu">
        <div className="flex h-16 items-center px-5">{brand}</div>
        <div className="px-3 pb-2">
          <Suspense fallback={<div className="h-20" />}>
            <ContextSwitcher workspaces={workspaces} currentWorkspaceId={current.id} currentBrandId={brandId} layout="stacked" />
          </Suspense>
        </div>
        <SidebarNav nav={nav} footer={<Account email={user.email} plan={`Paket: ${PLAN_LABEL[current.planKey] ?? current.planKey}`} />} />
      </aside>
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur-sm sm:px-6 lg:hidden">
          <MobileNav nav={nav} footer={<Account email={user.email} plan={`Paket: ${PLAN_LABEL[current.planKey] ?? current.planKey}`} />} />
          <Suspense fallback={<div className="flex-1" />}>
            <ContextSwitcher workspaces={workspaces} currentWorkspaceId={current.id} currentBrandId={brandId} layout="inline" idSuffix="-m" />
          </Suspense>
          {current.isDemo ? <Badge tone="warning">{t("common.demoData")}</Badge> : null}
        </header>
        {current.isDemo ? (
          <div className="hidden justify-end px-8 pt-4 lg:flex">
            <Badge tone="warning">{t("common.demoData")}</Badge>
          </div>
        ) : null}
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}

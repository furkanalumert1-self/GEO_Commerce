"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2,
  ChevronDown,
  CreditCard,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Menu,
  MessageSquareText,
  Package,
  Plug,
  Bell,
  Settings,
  ShoppingBag,
  Users,
  Rocket,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui";

/** Sunucudan istemciye yalnız serileştirilebilir veri geçer; ikonlar burada anahtarla eşlenir. */
export type NavIcon = "overview" | "visibility" | "growth" | "sales" | "reports" | "settings" | "portfolio" | "clients" | "setup" | "notifications" | "catalog" | "integrations" | "team" | "billing";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  visibility: MessageSquareText,
  growth: Lightbulb,
  sales: ShoppingBag,
  reports: FileText,
  settings: Settings,
  portfolio: Building2,
  clients: Users,
  setup: Rocket,
  notifications: Bell,
  catalog: Package,
  integrations: Plug,
  team: Users,
  billing: CreditCard,
};

export interface NavItem {
  label: string;
  href: string;
  icon?: NavIcon;
  /** Bu linki aktif sayacak ek yol önekleri (ör. Sorular → prompts, runs). */
  match?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  icon: NavIcon;
  items: NavItem[];
}

export type NavEntry = ({ kind: "link" } & NavItem) | ({ kind: "group" } & NavGroup);

export interface NavModel {
  main: NavEntry[];
  bottom: NavEntry[];
}

function pathOf(href: string) {
  return href.split("?")[0]!;
}

export function isActive(pathname: string, item: NavItem): boolean {
  return [pathOf(item.href), ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function Leaf({ item, pathname, nested, onNavigate }: { item: NavItem; pathname: string; nested?: boolean; onNavigate?: () => void }) {
  const active = isActive(pathname, item);
  const Icon = item.icon ? ICONS[item.icon] : null;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-2.5 rounded-full pr-3 text-sm lg:min-h-10",
        nested ? "pl-9" : "pl-3",
        active ? "bg-primary-soft font-semibold text-primary-hover shadow-[0_1px_2px_rgb(164_71_50/8%)]" : "text-text hover:bg-surface-subtle",
      )}
    >
      {Icon ? <Icon size={18} aria-hidden className={active ? "text-primary" : "text-text-secondary"} /> : null}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Group({ group, pathname, onNavigate }: { group: NavGroup; pathname: string; onNavigate?: () => void }) {
  const containsActive = group.items.some((i) => isActive(pathname, i));
  const [open, setOpen] = useState(containsActive);
  const [wasActive, setWasActive] = useState(containsActive);
  // Aktif alt sayfanın grubu her zaman açılır (geri/ileri dahil); render sırasında state ayarı.
  if (containsActive !== wasActive) {
    setWasActive(containsActive);
    if (containsActive) setOpen(true);
  }
  const Icon = ICONS[group.icon];
  const panelId = `nav-group-${group.id}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-full px-3 text-left text-sm lg:min-h-10",
          containsActive ? "font-semibold text-text" : "text-text hover:bg-surface-subtle",
        )}
      >
        <Icon size={18} aria-hidden className={containsActive ? "text-primary" : "text-text-secondary"} />
        <span className="flex-1 truncate">{group.label}</span>
        <ChevronDown size={16} aria-hidden className={cn("text-muted transition-transform duration-150", open && "rotate-180")} />
      </button>
      <ul id={panelId} hidden={!open} className="mt-0.5 flex flex-col gap-0.5">
        {group.items.map((i) => (
          <li key={i.href}>
            <Leaf item={i} pathname={pathname} nested onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryList({ entries, pathname, onNavigate }: { entries: NavEntry[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((e) => (
        <li key={e.kind === "group" ? e.id : e.href}>
          {e.kind === "group" ? <Group group={e} pathname={pathname} onNavigate={onNavigate} /> : <Leaf item={e} pathname={pathname} onNavigate={onNavigate} />}
        </li>
      ))}
    </ul>
  );
}

export function SidebarNav({ nav, onNavigate, footer, label = "Ana gezinme" }: { nav: NavModel; onNavigate?: () => void; footer?: ReactNode; label?: string }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={label} className="flex-1 overflow-y-auto px-3 py-3">
        <EntryList entries={nav.main} pathname={pathname} onNavigate={onNavigate} />
        {nav.bottom.length ? (
          <div className="mt-6 border-t border-border pt-3">
            <EntryList entries={nav.bottom} pathname={pathname} onNavigate={onNavigate} />
          </div>
        ) : null}
      </nav>
      {footer}
    </div>
  );
}

/** Mobil/tablet drawer: Radix Dialog → focus trap, Escape, focus restore. */
export function MobileNav({ nav, header, footer }: { nav: NavModel; header?: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-subtle lg:hidden" aria-label="Menüyü aç">
        <Menu size={18} aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(24_32_24/0.28)]" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[288px] max-w-[85vw] flex-col rounded-r-[var(--radius-xl)] bg-surface shadow-[var(--shadow-overlay)]"
          aria-describedby={undefined}
        >
          <div className="flex h-14 items-center justify-between border-b border-border pl-4 pr-2">
            <Dialog.Title className="font-semibold">Menü</Dialog.Title>
            <Dialog.Close className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-subtle" aria-label="Menüyü kapat">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          {header}
          <SidebarNav nav={nav} onNavigate={() => setOpen(false)} footer={footer} label="Mobil gezinme" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

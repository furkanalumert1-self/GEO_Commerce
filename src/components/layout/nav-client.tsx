"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui";

export interface NavItem {
  label: string;
  href: string;
}

export function NavLinks({ groups, onNavigate }: { groups: Array<{ heading: string; items: NavItem[] }>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.heading}>
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.heading}</p>
          <ul className="flex flex-col">
            {g.items.map((i) => {
              const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-11 items-center rounded-md px-2 text-sm lg:min-h-9", active ? "bg-primary-soft font-medium text-primary" : "text-text hover:bg-bg")}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Mobil drawer: Radix Dialog → focus trap, Escape, focus restore. */
export function MobileNav({ groups }: { groups: Array<{ heading: string; items: NavItem[] }> }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border lg:hidden" aria-label="Menüyü aç">
        <Menu size={18} aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-lg" aria-describedby={undefined}>
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <Dialog.Title className="font-semibold">Menü</Dialog.Title>
            <Dialog.Close className="inline-flex h-11 w-11 items-center justify-center rounded-md" aria-label="Menüyü kapat">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Mobil gezinme">
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

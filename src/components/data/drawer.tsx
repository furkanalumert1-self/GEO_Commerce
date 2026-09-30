"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/** Deep-link'li drawer: URL'deki param ile açılır; Escape/kapat param'ı kaldırır. Focus trap Radix'ten. */
export function UrlDrawer({ param, title, children }: { param: string; title: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const close = () => {
    const q = new URLSearchParams(sp.toString());
    q.delete(param);
    router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-surface shadow-lg" aria-describedby={undefined}>
          <div className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-4">
            <Dialog.Title className="font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="inline-flex h-11 w-11 items-center justify-center rounded-md" aria-label="Kapat">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

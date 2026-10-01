"use client";

import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

/** Shopify mağaza adresini alır, OAuth yetkilendirmesine yönlendirir. "Bağlı" durumu yalnız dönüşte doğrulanır. */
export function ShopifyConnectForm({ url, initialShop, label, disabledReason }: { url: string; initialShop?: string; label: string; disabledReason?: string }) {
  const [shop, setShop] = useState(initialShop ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shopDomain: shop }) });
      const json = await res.json().catch(() => null);
      const authUrl = json?.data?.authUrl as string | undefined;
      if (!res.ok || !authUrl || !/^https:\/\/[a-z0-9-]+\.myshopify\.com\//.test(authUrl)) {
        setError(`${json?.error?.message ?? "Bağlantı başlatılamadı"}${json?.requestId ? ` · istek no: ${json.requestId}` : ""}`);
        setPending(false);
        return;
      }
      window.location.assign(authUrl);
    } catch {
      setError("Bağlantı hatası; tekrar deneyin");
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Field label="Shopify mağaza adresi" htmlFor="shopify-shop" error={error ?? undefined} hint="ör. magaza-adi.myshopify.com">
        <input id="shopify-shop" className={inputClass} value={shop} onChange={(e) => setShop(e.target.value)} placeholder="magaza-adi.myshopify.com" disabled={Boolean(disabledReason)} aria-invalid={error ? true : undefined} aria-describedby={error ? "shopify-shop-error" : "shopify-shop-hint"} required />
      </Field>
      <Button type="submit" variant="primary" disabled={pending || Boolean(disabledReason) || shop.trim().length < 3}>{pending ? "Yönlendiriliyor…" : label}</Button>
      {disabledReason ? <p className="text-xs text-text-secondary">{disabledReason}</p> : null}
    </form>
  );
}

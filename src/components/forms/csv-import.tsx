"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

const PRODUCT_FIELDS = ["externalId", "name", "price", "currency", "sku", "category", "url", "availability", "stock"] as const;
const ORDER_FIELDS = ["orderId", "currency", "paidAt", "status", "productId", "sku", "itemName", "quantity", "unitPrice", "refundId", "refundAmount", "refundedAt", "anonymousId"] as const;

/** Sütun anahtarları API sözleşmesidir; kullanıcıya Türkçe adlarıyla gösterilir. */
const FIELD_LABEL: Record<string, string> = {
  externalId: "Ürün kodu (zorunlu)", name: "Ürün adı (zorunlu)", price: "Fiyat", currency: "Para birimi", sku: "Stok kodu (SKU)", category: "Kategori", url: "Ürün sayfası adresi", availability: "Stok durumu", stock: "Stok adedi",
  orderId: "Sipariş no", paidAt: "Ödeme tarihi", status: "Durum", productId: "Ürün kodu", itemName: "Ürün adı", quantity: "Adet", unitPrice: "Birim fiyat", refundId: "İade no", refundAmount: "İade tutarı", refundedAt: "İade tarihi", anonymousId: "Ziyaretçi kimliği",
};

const SAMPLE_PRODUCTS = "externalId,name,price,currency,sku,category,url,availability,stock\nYST-001,Visco Ortopedik Yastık,899.90,TRY,YST-001,Yastık,https://magazaniz.com/urun/visco-yastik,in stock,25\nBBY-070,Bebek Yatağı 70x110,1499.00,TRY,BBY-070,Bebek Yatağı,https://magazaniz.com/urun/bebek-yatagi-70x110,in stock,8\n";

export function CsvImportForm({ url, initialKind = "products" }: { url: string; initialKind?: "products" | "orders" }) {
  const router = useRouter();
  const [kind, setKind] = useState<"products" | "orders">(initialKind);
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const header = csv.split(/\r?\n/)[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? [];
  const fields = kind === "products" ? PRODUCT_FIELDS : ORDER_FIELDS;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return setMsg({ tone: "err", text: "Dosya 2 MB sınırını aşıyor" });
    if (!/\.(csv|txt)$/i.test(f.name)) return setMsg({ tone: "err", text: "Yalnız .csv dosyaları" });
    const text = await f.text();
    setCsv(text);
    const h = text.split(/\r?\n/)[0]?.split(",").map((x) => x.trim().replace(/^"|"$/g, "")) ?? [];
    setMapping(Object.fromEntries(fields.filter((fl) => h.includes(fl)).map((fl) => [fl, fl])));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, csv, mapping }) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setMsg({ tone: "err", text: `${body?.error?.message ?? "İçe aktarma başarısız"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}` });
    setMsg({ tone: "ok", text: `${body.data.imported} kayıt içe aktarıldı${body.data.skipped ? `, ${body.data.skipped} satır atlandı (eksik veya hatalı bilgi)` : ""}.` });
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Veri türü" htmlFor="csv-kind">
          <select id="csv-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as "products" | "orders")}>
            <option value="products">Ürün listesi</option>
            <option value="orders">Sipariş ve iade listesi (gelir ölçümü için)</option>
          </select>
        </Field>
        <Field label="Dosya (.csv)" htmlFor="csv-file" hint="Excel'de “CSV UTF-8” olarak kaydedin; ilk satır sütun adları. En fazla 2 MB.">
          <input id="csv-file" type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>
      {header.length > 1 ? (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Dosyanızdaki hangi sütun hangi bilgi?</legend>
          {fields.map((f) => (
            <Field key={f} label={FIELD_LABEL[f] ?? f} htmlFor={`map-${f}`}>
              <select id={`map-${f}`} className={inputClass} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                <option value="">— kullanma —</option>
                {header.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </Field>
          ))}
        </fieldset>
      ) : null}
      {msg ? <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || !csv}>{pending ? "Aktarılıyor…" : "İçe aktar"}</Button>
        {kind === "products" ? (
          <Button type="button" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([SAMPLE_PRODUCTS], { type: "text/csv;charset=utf-8" })); a.download = "urun-ornek.csv"; a.click(); }}>Örnek dosyayı indir</Button>
        ) : null}
      </div>
    </form>
  );
}

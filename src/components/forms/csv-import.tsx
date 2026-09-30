"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

const PRODUCT_FIELDS = ["externalId", "name", "price", "currency", "sku", "category", "url", "availability", "stock"] as const;
const ORDER_FIELDS = ["orderId", "currency", "paidAt", "status", "productId", "sku", "itemName", "quantity", "unitPrice", "refundId", "refundAmount", "refundedAt", "anonymousId"] as const;

export function CsvImportForm({ url }: { url: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"products" | "orders">("products");
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
    setMsg({ tone: "ok", text: `${body.data.imported} kayıt içe aktarıldı, ${body.data.skipped} atlandı.` });
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Veri türü" htmlFor="csv-kind">
          <select id="csv-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as "products" | "orders")}>
            <option value="products">Ürün kataloğu</option>
            <option value="orders">Siparişler ve iadeler</option>
          </select>
        </Field>
        <Field label="CSV dosyası" htmlFor="csv-file" hint="UTF-8, virgülle ayrılmış, ilk satır başlık. En fazla 2 MB.">
          <input id="csv-file" type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>
      {header.length > 1 ? (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Sütun eşlemesi</legend>
          {fields.map((f) => (
            <Field key={f} label={f} htmlFor={`map-${f}`}>
              <select id={`map-${f}`} className={inputClass} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                <option value="">— eşleme yok —</option>
                {header.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </Field>
          ))}
        </fieldset>
      ) : null}
      {msg ? <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending || !csv}>{pending ? "Aktarılıyor…" : "İçe aktar"}</Button>
      </div>
    </form>
  );
}

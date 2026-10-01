import Link from "next/link";
import type { Metadata } from "next";
import { Card, TableWrap, Td, Th } from "@/components/ui";
import { formatUsd, PLANS, type PlanKey } from "@/modules/billing/plans";
import { fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Fiyatlar" };

const COLS: PlanKey[] = ["starter", "growth", "commerce", "agency", "enterprise"];

function engines(k: PlanKey) {
  const e = PLANS[k].limits.engines;
  if (k === "enterprise") return "Özel";
  return e === "all_connected" ? "Tüm bağlı motorlar" : e.map((x) => ({ chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" })[x as "chatgpt"] ?? x).join(", ");
}

export default function PricingPage() {
  const rows: Array<[string, (k: PlanKey) => string]> = [
    ["Marka / koltuk", (k) => (k === "enterprise" ? "Sözleşme" : `${PLANS[k].limits.brands} / ${PLANS[k].limits.seats}`)],
    ["Rakip / marka", (k) => (k === "enterprise" ? "Özel" : String(PLANS[k].limits.competitorsPerBrand))],
    ["Motorlar", engines],
    ["Aktif prompt", (k) => (k === "enterprise" ? "Özel" : `${fmtNumber(PLANS[k].limits.activePrompts)}${k === "agency" ? " (havuz)" : ""}`)],
    ["Yanıt birimi / ay", (k) => (k === "enterprise" ? "Özel" : `${fmtNumber(PLANS[k].limits.answerUnits)}${k === "agency" ? " (havuz)" : ""}`)],
    ["Otomatik ölçüm", (k) => (k === "enterprise" ? "Özel" : PLANS[k].limits.monitoringFrequency === "weekly" ? "Haftalık" : "Günlük (bütçeli)")],
    ["Fırsatlar", (k) => (k === "starter" ? "İlk 10 detay" : k === "enterprise" ? "Özel" : "Tüm üretilenler")],
    ["Teşhis / Fix with AI", (k) => (PLANS[k].limits.fixUnits === 0 ? "—" : k === "enterprise" ? "Özel" : `✓ / ${PLANS[k].limits.fixUnits} üretim`)],
    ["Entegrasyon / gelir / Ads", (k) => (PLANS[k].limits.features.includes("commerce") ? "✓" : "—")],
    ["Crawl URL / ay", (k) => (k === "enterprise" ? "Özel" : fmtNumber(PLANS[k].limits.crawlUrls))],
    ["Aktif katalog ürünü", (k) => (k === "enterprise" ? "Özel" : fmtNumber(PLANS[k].limits.catalogProducts))],
    ["Commerce event / ay", (k) => (PLANS[k].limits.commerceEvents === 0 ? "—" : k === "enterprise" ? "Özel" : fmtNumber(PLANS[k].limits.commerceEvents))],
    ["Analytics saklama", (k) => (k === "enterprise" ? "Özel" : `${PLANS[k].limits.retentionDays} gün`)],
    ["Rapor", (k) => ({ starter: "CSV + aylık", growth: "+ haftalık PDF", commerce: "+ gelir", agency: "+ white-label", enterprise: "+ SLA/SSO (sözleşme)" })[k as "starter"]],
    ["Public API / webhook", (k) => (PLANS[k].limits.features.includes("public_api") ? "✓" : "—")],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fiyatlar</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          USD / ay; vergiler ve reklam harcaması hariç. Ücretsiz abonelik yoktur: tek seferlik ücretsiz GEO Audit ve kart gerektirmeyen 7 günlük Starter denemesi (100 yanıt birimi, 10 soru, 1 marka) sunulur. Deneme sonunda otomatik tahsilat yapılmaz. Otomatik aşım ücreti kapalıdır; kotalar dolduğunda yeni işler durur, veriler okunabilir kalır.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {COLS.map((k) => (
          <Card key={k} className="flex flex-col gap-2 p-4">
            <h2 className="font-semibold">{PLANS[k].label}</h2>
            <p className="tabular text-2xl font-semibold">
              {formatUsd(PLANS[k].monthlyPriceUsdCents)}
              {PLANS[k].monthlyPriceUsdCents ? <span className="text-sm font-normal text-muted"> / ay</span> : null}
            </p>
            <Link href={k === "enterprise" ? "mailto:sales@example.invalid" : "/audit"} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-bg">
              {k === "enterprise" ? "Teklif isteyin" : "Audit ile başlayın"}
            </Link>
          </Card>
        ))}
      </div>
      <Card>
        <TableWrap label="Paket karşılaştırma tablosu">
          <thead>
            <tr>
              <Th>Özellik / aylık önerilen kota</Th>
              {COLS.map((k) => (
                <Th key={k} numeric>{PLANS[k].label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label}>
                <Td>{label}</Td>
                {COLS.map((k) => (
                  <Td key={k} numeric>{fn(k)}</Td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="border-t border-border px-4 py-3 text-xs text-muted">
          1 yanıt birimi = 1 soru × 1 platform × 1 ülke/dil × 1 tekrar (tek bir AI yanıtı). Başarısız yanıtlar kota tüketmez. Kotalar ürün varsayılanlarıdır; Enterprise limitleri sözleşmeyle belirlenir.
        </p>
      </Card>
    </div>
  );
}

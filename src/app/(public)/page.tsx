export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { AuditForm } from "@/components/forms/audit-form";

export default function LandingPage() {
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="hero" className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <h1 id="hero" className="text-[32px] font-semibold leading-tight tracking-[-0.01em] sm:text-[40px]">AI önerilerinde daha görünür olun.</h1>
          <p className="mt-3 max-w-xl text-[17px] text-text-secondary">Markanızın nerede görünmediğini keşfedin, içerik iyileştirmelerini hazırlayın ve sonuçlarını ölçün.</p>
          <div className="mt-6 max-w-xl rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-base font-semibold">Ücretsiz GEO Audit ile başlayın</h2>
            <p className="mt-1 text-sm text-text-secondary">GEO (Generative Engine Optimization): markanızın ChatGPT, Gemini ve Perplexity gibi AI asistanların yanıtlarında görünürlüğü. Alan adınızı girin; ilk tarama için e-posta gerekmez.</p>
            <div className="mt-4">
              <AuditForm demo={demo} />
            </div>
          </div>
        </div>
        <figure aria-labelledby="preview-caption" className="rounded-[var(--radius-xl)] border border-border bg-bg p-4 shadow-[var(--shadow-card)] sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Genel Bakış önizlemesi</p>
            <span className="rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">Örnek veri</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {[
              ["AI görünürlüğü", "34", "/ 100"],
              ["Rekabet payı", "23,1", "%"],
              ["Açık fırsat", "9", ""],
              ["AI kaynaklı gelir", "—", ""],
            ].map(([label, value, unit]) => (
              <div key={label} className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
                <p className="text-xs text-text-secondary">{label}</p>
                <p className="tabular mt-1 text-xl font-semibold">{value}<span className="ml-1 text-xs font-normal text-text-secondary">{unit}</span></p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 rounded-[var(--radius-lg)] border border-border border-l-[3px] border-l-primary bg-surface p-3 text-sm">
            <p className="text-xs text-text-secondary">Öncelik 1 · Niyet-içerik boşluğu</p>
            <p className="mt-0.5 font-medium">Hassas cilt güneş kremi sorularında markanız görünmüyor.</p>
            <p className="mt-0.5 text-xs text-text-secondary">İncelenen 12 yanıtın 8&apos;inde rakipler anılıyor.</p>
          </div>
          <figcaption id="preview-caption" className="mt-3 text-xs text-text-secondary">Kurgusal örnek veriyle hazırlanmış ekran önizlemesi; gerçek bir markanın sonucu veya garanti değildir.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="loop">
        <h2 id="loop" className="sr-only">Nasıl çalışır</h2>
        <ol className="grid gap-2 text-sm sm:grid-cols-5">
          {["Keşfet", "Teşhis et", "Düzelt", "Ölç", "Gelir"].map((s, i) => (
            <li key={s} className="rounded-md border border-border bg-surface px-3 py-2">
              <span className="tabular text-text-secondary">{i + 1}.</span> {s}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="what" className="grid gap-4 md:grid-cols-3">
        <h2 id="what" className="sr-only">Neler ölçülür</h2>
        {[
          ["Tekrarlanabilir görünürlük", "Her gözlem sağlayıcı, model, yüzey (API web aramalı / aramasız / lisanslı UI), ülke, dil, tarih ve örneklem sayısıyla saklanır. Mention ve citation ayrı ölçülür."],
          ["Kanıta dayalı fırsatlar", "Fırsat skoru niyet, görünürlük farkı, katalog uyumu, kanıt gücü ve uygulanabilirlikten hesaplanır; her bileşen ve gerekçe açılabilir."],
          ["Gözlemlenen gelir", "Mağaza siparişleriyle doğrulanan, izinli ölçümle eşleşen AI kaynaklı oturum ve siparişler; ilişkilendirilemeyen kısım ayrıca gösterilir."],
        ].map(([title, body]) => (
          <Card key={title} className="p-5">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </Card>
        ))}
      </section>

      <section aria-labelledby="trust" className="rounded-md border border-border bg-surface p-5">
        <h2 id="trust" className="font-semibold">Veri ve güven</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>API yanıtları ChatGPT/Gemini uygulamasındaki kesin sıralama olarak sunulmaz; tüketici arayüzü takibi yalnız izinli/lisanslı kaynakla açılır.</li>
          <li>Kullanıcıların veya rakiplerin özel AI konuşmalarına erişim iddiası yoktur.</li>
          <li>Eksik veri &quot;ölçülemedi&quot; olarak gösterilir; sıfır sayılmaz. Başarısız sorgular görünürlük düşüşü değildir.</li>
          <li>Raporunuz varsayılan olarak özeldir; paylaşım bağlantıları süreli ve iptal edilebilir.</li>
        </ul>
        <p className="mt-3 text-sm">
          <Link href="/pricing" className="text-primary underline-offset-2 hover:underline">Paketleri karşılaştırın</Link>
        </p>
      </section>
    </div>
  );
}

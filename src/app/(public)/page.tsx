import Link from "next/link";
import { Card } from "@/components/ui";
import { AuditForm } from "@/components/forms/audit-form";
import { config } from "@/lib/config";

export default function LandingPage() {
  const demo = config().DEMO_MODE;
  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="hero" className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <div>
          <h1 id="hero" className="text-2xl font-semibold sm:text-3xl">
            AI asistanların önerdiği markalar arasında olun; kaybettiğiniz satın alma niyetlerini bulun, düzeltin ve ölçün.
          </h1>
          <p className="mt-3 max-w-2xl text-muted">
            ChatGPT, Gemini ve Perplexity API yanıtlarında markanızın görünürlüğünü tekrarlanabilir şekilde ölçer; rakiplere kaybettiğiniz niyetleri kanıtıyla gösterir; içerik, ürün ve kategori iyileştirmelerini hazırlar; gözlemlenebilir trafik ve satış katkısını ayrı raporlar.
          </p>
          <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-5">
            {["Keşfet", "Teşhis et", "Düzelt", "Ölç", "Gelir"].map((s, i) => (
              <li key={s} className="rounded-md border border-border bg-surface px-3 py-2">
                <span className="tabular text-muted">{i + 1}.</span> {s}
              </li>
            ))}
          </ol>
        </div>
        <Card className="p-5">
          <h2 className="text-base font-semibold">Ücretsiz GEO Audit</h2>
          <p className="mt-1 text-sm text-muted">Alan adınızı girin; site hazırlığı ve örneklem AI görünürlüğü raporu genellikle birkaç dakikada hazırlanır (garanti değildir). İlk tarama için e-posta gerekmez.</p>
          <div className="mt-4">
            <AuditForm demo={demo} />
          </div>
        </Card>
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

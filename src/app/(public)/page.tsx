export const dynamic = "force-dynamic";

import { Check } from "lucide-react";
import { Card } from "@/components/ui";
import { AuditForm } from "@/components/forms/audit-form";

const BENEFITS = [
  "AI önerilerindeki yerinizi görün",
  "Rakiplerin öne çıktığı soruları keşfedin",
  "ChatGPT reklamları için plan ve içerik taslakları hazırlayın",
];

const STEPS = [
  ["Ölçün", "Sitenizi tarar, müşterilerinizin sorabileceği soruları AI asistanlarına sorarız."],
  ["Karşılaştırın", "Hangi sorularda rakiplerin öne çıktığını ve hangi kaynakların gösterildiğini görün."],
  ["Harekete geçin", "Öncelikli fırsatlar için içerik taslakları ve ChatGPT reklam planı hazırlayın; yayın onayınıza bağlıdır."],
];

export default function LandingPage() {
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      <section aria-labelledby="hero" className="grid gap-7 pt-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-14 lg:pt-10">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-text-secondary">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-primary" />
            AI görünürlük ve ChatGPT reklam hazırlığı
          </span>
          <h1 id="hero" className="mt-5 text-[36px] font-bold leading-[1.08] tracking-[-0.02em] lg:text-[56px]">
            AI’da görünür olun, <span className="text-primary">ChatGPT reklamlarına hazırlanın.</span>
          </h1>
          <p className="mt-5 max-w-[560px] text-[17px] text-text-secondary lg:text-[19px]">Markanızın AI yanıtlarındaki görünürlüğünü ölçün, rakiplerle karşılaştırın ve ChatGPT reklamları için fırsatları keşfedin.</p>
          <ul className="mt-6 grid gap-3 text-base lg:text-[17px]">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-center gap-3">
                <span aria-hidden className="grid h-6 w-6 flex-none place-items-center rounded-full bg-success-soft text-success"><Check size={14} strokeWidth={2.5} /></span>
                {b}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-text-secondary">Kart gerekmez · Yalnız herkese açık sayfalar taranır</p>
        </div>

        <Card className="rounded-[24px] p-5 sm:p-7">
          <h2 className="text-[22px] font-semibold">Ücretsiz ölçüm</h2>
          <p className="mb-5 mt-1 text-[15px] text-text-secondary">Web sitenizi girin; analiz birkaç dakika sürebilir, sayfa açık kalmalıdır.</p>
          <AuditForm demo={demo} />
          <p className="mt-4 border-t border-border pt-4 text-[13px] text-text-secondary">Ölçüm reklam başlatmaz. Reklam yayını, sağlayıcı erişimi ve hesap uygunluğuna bağlıdır.</p>
        </Card>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl font-semibold lg:text-[28px]">Nasıl çalışır?</h2>
        <p className="mb-5 mt-1 text-text-secondary">Üç adımda AI görünürlüğünüzden somut aksiyona.</p>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <Card className="h-full p-5 sm:p-6">
                <span aria-hidden className="mb-3 grid h-8 w-8 place-items-center rounded-[10px] bg-primary-soft font-bold text-primary-hover">{i + 1}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] text-text-secondary">{body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

import { trOfCount } from "@/lib/format";
import { Badge, Card, CardHeader, TableWrap, Td, Th, inputClass } from "@/components/ui";
import type { buildChatgptAdsPlan } from "@/modules/ads/chatgpt-plan";
import { CHATGPT_ADS_SPEC } from "@/modules/ads/chatgpt";

type Plan = Awaited<ReturnType<typeof buildChatgptAdsPlan>>;
const STATUS: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  done: { tone: "success", label: "Hazır" },
  todo: { tone: "warning", label: "Yapılacak" },
  blocked: { tone: "danger", label: "Engel" },
  info: { tone: "neutral", label: "Bilgi" },
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const chars = (s: string) => [...s].length;

/** ChatGPT Ads'i hiç bilmeyen kullanıcı için adım adım kampanya planı (salt okunur; yayın Ads Manager'da). */
export function ChatgptAdsPlan({ plan, action, usps, downloadUrl }: { plan: Plan; action: string; usps: string[]; downloadUrl: string }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 text-sm">
        <p className="font-medium">ChatGPT Ads nedir, nasıl çalışır?</p>
        <ul className="mt-2 list-disc pl-5 text-muted">
          <li>Reklamınız, kullanıcı ChatGPT&apos;ye ilgili bir soru sorduğunda yanıtın altında küçük bir kart olarak çıkar: logo, başlık, kısa metin, kare görsel ve tek bir bağlantı.</li>
          <li>Google&apos;daki gibi anahtar kelime satın alınmaz. Hangi sohbetlerde görünmek istediğinizi &ldquo;bağlam ipuçları&rdquo; (ör. &ldquo;küçük ev için yataklı koltuk&rdquo;) ile anlatırsınız.</li>
          <li>Tıklama başına (TBM) ödersiniz; günlük bütçeyi siz belirlersiniz. Reklamlar yalnız ChatGPT Free ve Go kullanıcılarına, yetişkinlere ve hassas olmayan sohbetlerde gösterilir.</li>
          <li>Bu plan, AI görünürlük ölçümlerinizden hazırlanır: rakiplerin öne çıktığı sorular, reklamla görünmeniz gereken yerlerdir.</li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Adım adım yol haritası" description="Sırayla ilerleyin; her adımın durumu otomatik güncellenir." />
        <ol className="divide-y divide-border">
          {plan.steps.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
              <span className="tabular w-5 text-muted">{i + 1}.</span>
              <div className="min-w-0 flex-1"><p className="font-medium">{s.title} <Badge tone={STATUS[s.status]!.tone}>{STATUS[s.status]!.label}</Badge></p><p className="mt-0.5 text-muted">{s.detail}</p></div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Rakip analizi" description={`Son ${plan.sample.days} günde ${plan.sample.answers} AI yanıtı. ChatGPT Ads Manager rakip reklam/harcama verisi paylaşmaz; bu tablo rakiplerin AI yanıtlarında organik olarak öne çıktığı yerleri gösterir. Bu sorular, reklamla görünmeniz için en değerli bağlamlardır.`} />
        {plan.competitorInsights.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Onaylı rakip yok. Rakipler sayfasından ekleyin.</p> : (
          <TableWrap label="Rakip analizi">
            <thead><tr><Th>Rakip</Th><Th numeric>Yanıt payı</Th><Th numeric>Önerildiği</Th><Th>Öne çıktığı sorular</Th><Th>Atıf aldığı kaynaklar</Th></tr></thead>
            <tbody>
              {plan.competitorInsights.map((c) => (
                <tr key={c.id}>
                  <Td><p className="font-medium">{c.name}</p><p className="text-xs text-muted">{c.domain}</p></Td>
                  <Td numeric>%{c.shareOfAnswers}</Td>
                  <Td numeric>{c.recommendations}</Td>
                  <Td className="text-xs">{c.topPrompts.length ? c.topPrompts.join(" · ") : "—"}</Td>
                  <Td className="text-xs text-muted">{c.topSources.join(", ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {plan.sample.answers < 20 ? <p className="px-4 py-2 text-xs text-warning">Küçük örneklem: daha güvenilir analiz için soru sayısını artırıp birkaç ölçüm daha yapın.</p> : null}
      </Card>

      <Card>
        <CardHeader title="Markanızın öne çıkan özellikleri (opsiyonel)" description="Reklam metinlerinde kullanılır. Yalnız sitenizde doğrulanabilen bilgileri yazın (ör. 'Ücretsiz kargo', '2 yıl garanti', 'Yerli üretim'); kanıtsız iddialar reklam incelemesinde reddedilir." />
        <form action={action} method="get" className="flex flex-wrap items-end gap-2 p-4">
          <input type="hidden" name="tab" value="chatgpt" />
          <input name="usp1" defaultValue={usps[0] ?? ""} placeholder="Özellik 1" className={`${inputClass} max-w-xs`} maxLength={40} aria-label="Özellik 1" />
          <input name="usp2" defaultValue={usps[1] ?? ""} placeholder="Özellik 2" className={`${inputClass} max-w-xs`} maxLength={40} aria-label="Özellik 2" />
          <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm sm:min-h-10">Metinleri güncelle</button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Kampanya yapısı" description="1 kampanya → her ürün kategorisi/niyet için ayrı reklam grubu. Öncelik, rakiplere kaybedilen yanıt sayısına göredir; ilk ay en fazla 3 grupla başlayın." />
        <div className="flex flex-col divide-y divide-border">
          {plan.adGroups.slice(0, 3).map((g, i) => (
            <div key={g.clusterId} className="flex flex-col gap-3 p-4 text-sm">
              <p className="font-medium">Reklam grubu {i + 1}: {g.label} <Badge tone={g.priority === "yüksek" ? "danger" : g.priority === "orta" ? "warning" : "neutral"}>Öncelik: {g.priority}</Badge> </p>
              <p className="text-muted">{g.answers ? `${g.answers} yanıtın ${trOfCount(g.brandMentioned)} anıldınız.` : "Henüz ölçüm yok; kategoriden başlangıç önerisi."} {g.lostTo.length ? `Kaybedilen yanıtlarda öne çıkan: ${g.lostTo.map((c) => `${c.name} (${c.count})`).join(", ")}.` : ""}</p>
              <div>
                <p className="text-xs font-medium">Bağlam ipuçları (anahtar kelime yerine) · {g.hints.length}</p>
                <p className="mt-1 text-xs text-muted">ChatGPT Ads&apos;te kelime eşleşmesi yoktur; bu ifadeler hangi sohbetlerde görünmek istediğinizi anlatır. Ads Manager&apos;da reklam grubunun &ldquo;context hints&rdquo; alanına yapıştırın.</p>
                <p className="mt-1 rounded-md bg-bg px-2 py-1.5 text-xs">{g.hints.join(" · ")}</p>
                {g.competitorHints.length ? <p className="mt-1 text-xs"><span className="font-medium">Rakip karşılaştırma bağlamı:</span> {g.competitorHints.join(" · ")} <span className="text-muted">— bağlam olarak kullanılabilir; reklam metninde rakip markanın adını kullanmayın.</span></p> : null}
              </div>
              <div>
                <p className="text-xs font-medium">Reklam metni önerileri</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.copies.map((c, k) => (
                    <li key={k} className="rounded-md border border-border px-2 py-1.5 text-xs">
                      <span className="font-medium">{c.title}</span> <span className="text-muted">({chars(c.title)}/{CHATGPT_ADS_SPEC.title.max})</span><br />
                      {c.body} <span className="text-muted">({chars(c.body)}/{CHATGPT_ADS_SPEC.body.max})</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted">Hedef URL: bu kategorinin sitenizdeki sayfası. Görsel: kare, en az {CHATGPT_ADS_SPEC.image.minPxApi}px, üzerinde yazı olmayan net ürün fotoğrafı.</p>
              </div>
            </div>
          ))}
        </div>
        {plan.adGroups.length > 3 ? (
          <details className="border-t border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer text-primary">İkinci aşama için {plan.adGroups.length - 3} reklam grubu daha</summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
              {plan.adGroups.slice(3).map((g) => <li key={g.clusterId}><span className="font-medium text-text">{g.label}</span> · öncelik {g.priority}{g.lostTo.length ? ` · öne çıkan: ${g.lostTo.slice(0, 2).map((c) => c.name).join(", ")}` : ""}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted">İlk 3 grup 14 gün veri topladıktan sonra en iyi sonuç vereni koruyup bunları ekleyin. Tüm grupların bağlam ipuçları ve metinleri CSV&apos;de.</p>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Bütçe önerisi" description={`Tahmini tıklama başı maliyet (e-ticaret kıyası, ${plan.benchmarks.asOf}): ${usd(plan.benchmarks.cpc.low)}–${usd(plan.benchmarks.cpc.high)}, tipik ${usd(plan.benchmarks.cpc.typical)}. Tutarlar USD; Ads Manager hesabınızın para birimine çevirir. Kesin maliyet açık artırmaya göre değişir.`} />
        <TableWrap label="Bütçe kademeleri">
          <thead><tr><Th>Kademe</Th><Th numeric>Günlük tıklama</Th><Th numeric>Günlük bütçe</Th><Th numeric>Süre</Th><Th numeric>Toplam</Th><Th numeric>Başlangıç maks. TBM</Th></tr></thead>
          <tbody>
            {plan.budget.map((b) => (
              <tr key={b.key}>
                <Td><p className="font-medium">{b.label}</p><p className="text-xs text-muted">{b.description}</p></Td>
                <Td numeric>~{b.dailyClicks}</Td>
                <Td numeric>{usd(b.dailyBudget)}</Td>
                <Td numeric>{b.days} gün</Td>
                <Td numeric>{usd(b.total)}</Td>
                <Td numeric>{usd(b.maxCpc)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <ul className="list-disc px-8 py-3 text-xs text-muted">
          <li>Keşif testiyle başlayın; ilk 3 gün bütçeye dokunmayın (sistem öğreniyor).</li>
          <li>3 gün sonra gösterim çok azsa maks. TBM&apos;yi %10–20 artırın; bütçe her gün bitiyorsa ve satış geliyorsa bütçeyi artırın.</li>
          <li>Bir reklam grubu ~150 tıklamada hiç satış/sepet getirmediyse metni ve hedef sayfayı değiştirin veya durdurun.</li>
          <li>Bütçeyi haftada en fazla %20 artırın; satış başı maliyetinizi brüt kârınızın altında tutun.</li>
        </ul>
      </Card>

      <p className="text-sm"><a className="text-primary underline" href={`${downloadUrl}&format=csv`}>Planı CSV indir</a> · <a className="text-primary underline" href={`${downloadUrl}&format=json`}>JSON indir</a> <span className="text-xs text-muted">— Ads Manager&apos;da kampanyayı kurarken kontrol listesi olarak kullanın.</span></p>
    </div>
  );
}

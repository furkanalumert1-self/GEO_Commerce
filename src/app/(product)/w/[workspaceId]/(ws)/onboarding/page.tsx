import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader, cn } from "@/components/ui";
import { BrandCreateForm } from "@/components/forms/brand-create";
import { BrandSettingsStep } from "@/components/forms/brand-settings-step";
import { DomainVerification } from "@/components/forms/domain-verification";
import { ApiButton } from "@/components/forms/api-button";
import { RunPlanner } from "@/components/forms/run-planner";
import { db } from "@/lib/db";
import { pageBrand, pageWorkspace } from "@/lib/page-access";
import { engineAvailability } from "@/modules/monitoring/start";
import { isUuid } from "@/modules/tenancy/access";
import { JobStartButton } from "@/components/forms/job-start-button";
import { executionMode } from "@/lib/queue";
import { QuestionPicker } from "@/components/forms/question-picker";
import { loadPickerData } from "@/modules/prompts/picker";

export const metadata: Metadata = { title: "Kurulum" };

const STEPS = ["Marka ve alan adı", "Pazar ve marka bilgileri", "Keşfi onayla", "Rakipleri onayla", "Takip edeceğiniz sorular", "İlk ölçüm", "Mağaza bağlantısı"];

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const wa = await pageWorkspace(workspaceId);
  const firstBrand = await db.brand.findFirst({ where: { workspaceId, archivedAt: null, ...(wa.brandIds === "all" ? {} : { id: { in: wa.brandIds } }) }, orderBy: { createdAt: "asc" } });
  const brandId = sp.brand && isUuid(sp.brand) ? sp.brand : firstBrand?.id;
  if (!brandId) {
    return (
      <>
        <PageHeader title="Kurulum" description="Adım 1 / 7 — Marka ve alan adı" />
        <Card className="max-w-xl p-4"><BrandCreateForm url={`/api/v1/workspaces/${workspaceId}/brands`} workspaceId={workspaceId} /></Card>
      </>
    );
  }
  const access = await pageBrand(workspaceId, brandId);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: brandId } });
  const saved = (brand.onboarding ?? {}) as { step?: number; completed?: boolean };
  const step = Math.min(7, Math.max(1, Number(sp.step ?? saved.step ?? 1) || 1));
  const base = `/w/${workspaceId}/onboarding?brand=${brandId}`;
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const [pages, products, comps, prompts, runs] = await Promise.all([
    db.pageSnapshot.count({ where: { brandId } }),
    db.product.count({ where: { brandId } }),
    db.competitor.findMany({ where: { brandId, archivedAt: null } }),
    db.prompt.count({ where: { brandId, active: true } }),
    db.monitoringRun.count({ where: { brandId } }),
  ]);
  const picker = step === 5 ? await loadPickerData(db, { workspaceId, brandId }, brand, access.entitlements.activePrompts) : null;
  const nav = (
    <div className="mt-6 flex flex-wrap justify-between gap-2">
      {step > 1 ? <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm" href={`${base}&step=${step - 1}`}>Geri</Link> : <span />}
      <span className="flex gap-2">
        {step < 7 ? <Link className="inline-flex min-h-11 items-center rounded-md px-4 text-sm text-muted underline" href={`${base}&step=${step + 1}`}>Atla</Link> : null}
        {step < 7 ? <Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white" href={`${base}&step=${step + 1}`}>Devam</Link> : <Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white" href={`/w/${workspaceId}/b/${brandId}/dashboard`}>Panoya git</Link>}
      </span>
    </div>
  );
  return (
    <>
      <PageHeader title={`Kurulum · ${access.brand.name}`} description={`Adım ${step} / 7 — ${STEPS[step - 1]}. İlerlemeniz otomatik kaydedilir; kaldığınız yerden devam edebilirsiniz.`} badges={saved.completed ? <Badge tone="success">Tamamlandı</Badge> : null} />
      <ol className="mb-6 flex flex-wrap gap-1 text-xs" aria-label="Kurulum adımları">
        {STEPS.map((s, i) => (
          <li key={s}>
            <Link href={`${base}&step=${i + 1}`} aria-current={step === i + 1 ? "step" : undefined} className={cn("inline-flex min-h-11 items-center rounded-md border px-2 sm:min-h-8", step === i + 1 ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-muted")}>
              {i + 1}. {s}
            </Link>
          </li>
        ))}
      </ol>
      <Card className="max-w-3xl">
        <CardHeader title={STEPS[step - 1]!} />
        <div className="p-4 text-sm">
          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <p>Marka: <strong>{brand.name}</strong> · {brand.domain} {brand.verifiedAt ? <Badge tone="success">Doğrulandı</Badge> : <Badge>Doğrulanmadı</Badge>}</p>
              <p className="text-muted">Ölçüm için doğrulama gerekmez. Tracker, yazma yetkili bağlantı ve yayın için DNS TXT, HTML token veya yetkili OAuth ile sahiplik doğrulanmalıdır.</p>
              {!brand.verifiedAt ? <DomainVerification api={`${api}/verification`} /> : null}
            </div>
          ) : null}
          {step === 2 ? <BrandSettingsStep url={`${api}/onboarding`} initial={{ country: brand.country, language: brand.language, timezone: brand.timezone, currency: brand.currency, aliases: brand.aliases.join(", "), categories: brand.categories.join(", ") }} /> : null}
          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <p>{pages} sayfa ve {products} ürün keşfedildi. Hatalı veya hariç tutulacak URL&apos;leri katalogda düzeltin.</p>
              <div className="flex flex-wrap gap-2">
                <JobStartButton url={`${api}/crawls`} body={{ maxPages: 50 }} label="Siteyi tara" inline={executionMode() === "inline"} queuedMessage="Tarama kuyruğa alındı" runningLabel="Site taraması" />
                <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-3 sm:min-h-9" href={`/w/${workspaceId}/b/${brandId}/catalog`}>Kataloğu incele</Link>
              </div>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="flex flex-col gap-2">
              {comps.length === 0 ? <p className="text-muted">Rakip adayı yok.</p> : comps.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{c.name} · {c.domain}</span>
                  {c.confirmedAt ? <Badge tone="success">Onaylı</Badge> : <ApiButton url={`${api}/competitors/${c.id}`} method="PATCH" label="Onayla" />}
                </div>
              ))}
              <Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/competitors`}>Rakip ekle/çıkar</Link>
            </div>
          ) : null}
          {step === 5 && picker ? (
            <div className="flex flex-col gap-3">
              <p className="text-text-secondary">Müşterilerinizin AI asistanlarına sorabileceği soruları seçin. Ölçüm bu sorularla yapılır; reklam bütçesiyle ilgisi yoktur.</p>
              <QuestionPicker data={picker} api={api} nextHint="Sıradaki adım: İlk ölçüm." />
              <Link className="text-sm text-primary underline" href={`/w/${workspaceId}/b/${brandId}/prompts`}>Tüm takip ettiğim soruları gör</Link>
            </div>
          ) : null}
          {step === 6 ? (runs > 0 ? <p>İlk ölçüm yapıldı. <Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/visibility`}>Sonuçları gör</Link></p> : prompts === 0 ? <p className="text-muted">Önce takip edeceğiniz soruları seçin: <Link className="text-primary underline" href={`${base}&step=5`}>Adım 5 — Takip edeceğiniz sorular</Link>.</p> : <RunPlanner url={`${api}/runs`} engines={engineAvailability(access).all} locale={`${brand.language}-${brand.country}`} inline={executionMode() === "inline"} runPagePrefix={`/w/${workspaceId}/b/${brandId}/runs`} />) : null}
          {step === 7 ? (
            <div className="flex flex-col gap-2">
              <p>Gözlemlenen gelir için mağazanızı bağlayın veya CSV sipariş importu kullanın. Reklam erişimi olmaması GEO kullanımını engellemez.</p>
              <Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/integrations`}>Entegrasyonlar</Link>
              {!saved.completed ? <ApiButton url={`${api}/onboarding`} method="PATCH" body={{ step: 7, completed: true }} variant="primary" label="Kurulumu tamamla" redirectTo={`/w/${workspaceId}/b/${brandId}/dashboard`} /> : null}
            </div>
          ) : null}
          {nav}
        </div>
      </Card>
    </>
  );
}

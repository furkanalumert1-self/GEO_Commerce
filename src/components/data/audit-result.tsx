"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { isCompetitorCandidate } from "@/modules/audit/competitor-filter";

interface Check {
  id: string;
  group: "geo" | "ads";
  label: string;
  status: "pass" | "fail" | "not_detected" | "requires_verification";
  detail: string;
  priority: string;
}

interface Summary {
  brandName: string;
  demo: boolean;
  visibility: { score: number | null; smallSample: boolean; sampleCount: number; scheduled: number; partial: boolean; missingEngines: string[] };
  engines: Array<{ engine: string; score: number | null; coverage: number | null }>;
  unavailableEngines: Array<{ engine: string; reason: string | null }>;
  /** Bu ölçümde sorulan platformlar (eski raporlarda yok). */
  scopeEngines?: string[];
  failedCalls?: string[];
  failedDetails?: Record<string, string>;
  provenance: { models: string[]; surface: string; country: string; language: string; sampledAt: string; sampleCount: number };
  readiness: { geoScore: number | null; adsScore: number | null; checks: Check[] };
  crawl: { pages: number; failed: number; skippedByRobots: number; products: number; categories: string[]; truncated?: boolean; failures?: Array<{ url: string; reason: string }>; siteDomain?: string | null; wwwFallback?: boolean };
  /** Site hiç okunamadı: puan/fırsat/rakip üretilmedi. */
  siteUnreadable?: { kind: string; detail: string; wwwTried?: boolean };
  competitorCandidates: Array<{ domain: string; observations: number }>;
  opportunityCount: number;
  examples: Array<{ prompt: string; engine: string; competitorDomains: string[]; intentScore: number; intentType: string }>;
}

interface View {
  domain: string;
  status: string;
  stage: string;
  progress: { done: number; total: number };
  expiresAt: string;
  claimed: boolean;
  result: Summary | null;
  errorCode: string | null;
}

const STAGES: Record<string, string> = {
  queued: "Sırada",
  crawling: "Site inceleniyor",
  prompts: "Sorular hazırlanıyor",
  asking_engines: "AI platformlarına soruluyor",
  summarizing: "Özet hesaplanıyor",
  done: "Tamamlandı",
  failed: "Başarısız",
};

const STATUS_BADGE: Record<Check["status"], { tone: "success" | "danger" | "neutral" | "warning"; label: string }> = {
  pass: { tone: "success", label: "Geçti" },
  fail: { tone: "danger", label: "Sorun var" },
  not_detected: { tone: "neutral", label: "Tespit edilemedi" },
  requires_verification: { tone: "warning", label: "Doğrulama gerekli" },
};

const CALL_ERROR: Record<string, string> = {
  auth: "API anahtarı reddedildi",
  not_configured: "yapılandırılmamış",
  http_400: "istek/model reddedildi",
  http_404: "model bulunamadı",
  http_429: "hız sınırı",
  insufficient_quota: "hesapta kredi/kota yok (faturalandırma)",
  timeout: "zaman aşımı",
  network: "ağ hatası",
  search_unavailable: "web araması hesapta kapalı",
  search_failed: "web araması başarısız",
  refusal: "model yanıtlamadı",
  unavailable: "yanıt alınamadı",
};

/** Site okunamadığında neden ve yapılacak iş (kullanıcı dili; ham hata yalnız teknik ayrıntıda). */
const UNREADABLE: Record<string, { why: (d: string) => string; todo: string }> = {
  ssl: { why: (d) => `${d} güvenli bağlantı (SSL) hatası veriyor; www adresi de denendi ve açılmadı.`, todo: "Alan adı veya hosting panelinizde sitenin geçerli bir SSL sertifikasıyla açıldığından emin olun; www'suz adresi www adresine yönlendirmek de çözüm olabilir." },
  dns: { why: (d) => `${d} alan adı bulunamadı (DNS kaydı yok veya yanlış).`, todo: "Alan adını doğru yazdığınızdan ve DNS kayıtlarının siteyi gösterdiğinden emin olun." },
  timeout: { why: (d) => `${d} zamanında yanıt vermedi.`, todo: "Siteniz yavaş veya geçici olarak kapalı olabilir; biraz sonra tekrar deneyin." },
  refused: { why: (d) => `${d} sunucusu bağlantıyı reddetti.`, todo: "Sunucunun ziyaretçilere açık olduğunu ve bir güvenlik duvarının otomatik ziyaretleri engellemediğini kontrol edin." },
  http: { why: (d) => `${d} sayfalarını açarken hata kodu döndü.`, todo: "Ana sayfanızın tarayıcıda açıldığını kontrol edin; sorun sürerse barındırma sağlayıcınızla görüşün." },
  robots: { why: (d) => `${d} robots.txt dosyası tüm sitenin incelenmesini engelliyor.`, todo: "AI ve arama tarayıcılarının sitenizi okuyabilmesi için robots.txt'deki genel engeli kaldırın." },
  network: { why: (d) => `${d} adresine bağlanılamadı.`, todo: "Sitenin tarayıcıda açıldığını kontrol edip tekrar deneyin." },
};

const ENGINE: Record<string, string> = { chatgpt: "ChatGPT (OpenAI API)", gemini: "Gemini (Google API)", claude: "Claude (Anthropic API)", perplexity: "Perplexity API" };

interface StepInfo {
  outcome: string;
  progress: { done: number; total: number } | null;
  resumable: boolean;
  error: string | null;
}

/**
 * `inline`: Redis'siz geçici dağıtım — audit, bu sayfa açıkken açık POST adımlarıyla ilerler (sekme kapanırsa
 * duraklar, geri gelince devam eder). Aksi halde worker yürütür ve sayfa yalnız durumu sorgular (GET).
 */
export function AuditResult({ token, initial, signedIn, inline = false }: { token: string; initial: View; signedIn: boolean; inline?: boolean }) {
  const [step, setStep] = useState<StepInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<View>(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const delay = useRef(2000);
  const router = useRouter();
  const running = view.status === "queued" || view.status === "running";

  useEffect(() => {
    if (!running || paused) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Inline: sıradaki adımı yürüt (POST). Worker modu: yalnız durumu oku (GET iş başlatmaz).
        const res = inline
          ? await fetch(`/api/v1/audits/${encodeURIComponent(token)}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" })
          : await fetch(`/api/v1/audits/${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Durum alınamadı");
        if (!cancelled) {
          const { step: st, ...v } = body.data as View & { step?: StepInfo };
          setView(v);
          setPollError(null);
          if (st) {
            setStep(st);
            if (st.error && st.outcome !== "busy" && st.outcome !== "continue") setPaused(true);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setPollError((e as Error).message);
          if (inline) setPaused(true);
        }
      }
      // Inline: adımlar ardışık (meşgulse 3 sn bekle); worker: 2s→10s artan sorgu aralığı.
      delay.current = inline ? 300 : Math.min(10_000, Math.round(delay.current * 1.5));
    }, inline && step?.outcome === "busy" ? 3000 : delay.current);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, token, view, inline, paused, step?.outcome]);

  const claim = async () => {
    setClaiming(true);
    setClaimError(null);
    const res = await fetch(`/api/v1/audits/${encodeURIComponent(token)}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await res.json().catch(() => null);
    setClaiming(false);
    if (!res.ok) {
      setClaimError(`${body?.error?.message ?? "Rapor kaydedilemedi"}${body?.requestId ? ` (istek no: ${body.requestId})` : ""}`);
      return;
    }
    router.push(`/w/${body.data.workspaceId}/onboarding?brand=${body.data.brandId}`);
  };

  const r = view.result;
  // Eski raporlarda kalmış haber/kamu/eğitim alan adları da gösterilmez.
  // Puan yalnız ölçülebilen kontrollerden hesaplanır; kaç kontrolün ölçüldüğü açıkça yazılır.
  const coverage = (group: "geo" | "ads") => {
    const list = r?.readiness.checks.filter((c) => c.group === group) ?? [];
    const measured = list.filter((c) => c.status === "pass" || c.status === "fail");
    const passed = measured.filter((c) => c.status === "pass").length;
    const open = list.length - measured.length;
    return `Ölçülen kontrol: ${measured.length}/${list.length}, geçen: ${passed}${open ? ` (ölçülemeyen/doğrulama bekleyen: ${open})` : ""}.`;
  };
  const candidates = (r?.competitorCandidates ?? []).filter((c) => isCompetitorCandidate(c.domain, view.domain));
  // Eski raporlarda site okunamadıysa (0 sayfa) kontrol maddeleri "bulunamadı" değil "ölçülemedi"dir.
  const notRead = (r?.crawl?.pages ?? 0) === 0;
  const unreadable = r?.siteUnreadable ? UNREADABLE[r.siteUnreadable.kind] ?? UNREADABLE.network! : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Ücretsiz ölçüm: {view.domain}</h1>
        {r?.demo ? <Badge tone="warning">Örnek veri</Badge> : null}
        <Badge tone={view.status === "succeeded" ? "success" : view.status === "partial" ? "warning" : view.status === "failed" ? "danger" : "primary"}>
          {view.status === "partial" ? "Kısmen tamamlandı" : r?.siteUnreadable ? "İncelenemedi" : view.status === "failed" ? "Başarısız" : (STAGES[view.stage] ?? view.stage)}
        </Badge>
      </div>

      {running ? (
        <Card className="p-5" aria-live="polite">
          <p className="font-medium">{STAGES[view.stage] ?? view.stage}</p>
          <p className="tabular mt-1 text-sm text-muted">
            Aşama {view.progress.done} / {view.progress.total}
          </p>
          <div className="mt-3 h-2 w-full rounded-sm bg-bg" role="progressbar" aria-valuemin={0} aria-valuemax={view.progress.total} aria-valuenow={view.progress.done} aria-label="Ölçüm ilerlemesi">
            <div className="h-2 rounded-sm bg-primary" style={{ width: `${(view.progress.done / Math.max(1, view.progress.total)) * 100}%` }} />
          </div>
          {inline && step?.progress && step.progress.total > 0 && view.stage === "asking_engines" ? (
            <p className="tabular mt-2 text-sm text-text-secondary">AI yanıtları: {step.progress.done} / {step.progress.total}</p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            {inline
              ? "Hızlı analiz: sınırlı sayfa ve küçük örneklem. Analiz bu sekme açıkken adım adım ilerler; sekme kapatılırsa duraklar, bağlantıya geri döndüğünüzde kaldığı yerden devam eder."
              : "Bu sayfayı kapatabilirsiniz; analiz arka planda sürer."}{" "}
            Bağlantı {new Date(view.expiresAt).toLocaleDateString("tr-TR")} tarihine kadar geçerlidir.
          </p>
          {pollError || (paused && step?.error) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
              <span>{pollError ?? step?.error}{inline ? "" : " — otomatik yeniden deneniyor."}</span>
              {inline && paused ? (
                <Button
                  onClick={() => {
                    setPaused(false);
                    setPollError(null);
                    setStep(null);
                  }}
                >
                  Devam et
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {r?.siteUnreadable && unreadable ? (
        <div className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft px-5 py-4" role="alert">
          <p className="font-semibold">Siteniz incelenemedi; bu yüzden görünürlük puanı ve öneri hesaplamadık.</p>
          <p className="mt-1">{unreadable.why(view.domain)}</p>
          <p className="mt-2 text-sm"><span className="font-semibold">Ne yapmalı? </span>{unreadable.todo}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="primary"><Link href="/audit">Düzelttikten sonra yeniden ölç</Link></Button>
          </div>
          <details className="mt-3 text-xs text-text-secondary">
            <summary className="cursor-pointer">Teknik ayrıntı</summary>
            <p className="mt-1 break-words">{r.siteUnreadable.detail}</p>
          </details>
          <p className="mt-3 text-xs text-text-secondary">Veri üretmeyen ölçüm ücretsiz hakkınızı tüketmez.</p>
        </div>
      ) : view.status === "failed" ? (
        <Alert tone="danger" title="Ölçüm tamamlanamadı">
          Siteniz okunamadı ve AI platformlarından yanıt alınamadı; nedenler aşağıdaki &ldquo;Nasıl ölçüldü&rdquo; bölümünde. Veri üretmeyen ölçüm ücretsiz hakkınızı tüketmez; sorun giderildikten sonra yeniden deneyebilirsiniz.
        </Alert>
      ) : null}

      {r && !r.siteUnreadable ? (
        <>
          {view.status === "partial" ? (
            <Alert tone="warning" title="Kısmen tamamlandı">
              Bazı adımlar tamamlanamadı. {r.visibility.missingEngines.length ? `Yanıt alınamayan platform: ${r.visibility.missingEngines.map((e) => ENGINE[e] ?? e).join(", ")}. ` : ""}
              {r.crawl.failed ? `${r.crawl.failed} sayfa okunamadı.` : ""}
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm text-muted">AI görünürlüğü</p>
              <p className="tabular mt-2 text-3xl font-semibold">{r.visibility.score ?? "Ölçülemedi"}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone="warning">Küçük örneklem ({r.visibility.sampleCount} yanıt)</Badge>
                {r.visibility.partial ? <Badge tone="warning">Kısmen</Badge> : null}
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">Site hazırlığı</p>
              <p className="tabular mt-2 text-3xl font-semibold">{r.readiness.geoScore ?? "Ölçülemedi"}</p>
              <p className="mt-2 text-xs text-muted">{coverage("geo")} Görünürlük puanından ayrıdır.</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">Reklam hazırlığı</p>
              <p className="tabular mt-2 text-3xl font-semibold">{r.readiness.adsScore ?? "Ölçülemedi"}</p>
              <p className="mt-2 text-xs text-muted">{coverage("ads")} Reklam hesabı uygunluğu ve ödeme adımı ayrıca doğrulanmalıdır.</p>
            </Card>
          </div>

          <Card>
            <CardHeader title="Nasıl ölçüldü" />
            <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
              <p><span className="text-muted">Yöntem:</span> AI platformlarının web aramalı API yanıtları — ChatGPT/Gemini/Claude uygulamasındaki sonuçla birebir aynı değildir</p>
              {r.scopeEngines?.length ? <p><span className="text-muted">Platformlar:</span> {r.scopeEngines.map((e) => ENGINE[e] ?? e).join(", ")}</p> : null}
              <p><span className="text-muted">Ülke / dil (istenen pazar):</span> {r.provenance.country} / {r.provenance.language}</p>
              <p><span className="text-muted">Modeller:</span> {r.provenance.models.join(", ") || "—"}</p>
              <p><span className="text-muted">Yanıtlar:</span> {r.provenance.sampleCount} başarılı yanıt · {new Date(r.provenance.sampledAt).toLocaleString("tr-TR")}</p>
              <p><span className="text-muted">Site incelemesi:</span> {r.crawl.pages} sayfa okundu, {r.crawl.products} ürün bulundu, robots kuralıyla atlanan {r.crawl.skippedByRobots}{r.crawl.failed ? `, okunamayan ${r.crawl.failed}` : ""}{r.crawl.truncated ? " (hızlı analiz: sınırlı tarama)" : ""}</p>
              {r.crawl.siteDomain ? <p><span className="text-muted">Yönlendirme:</span> {view.domain} → {r.crawl.siteDomain} (analiz yönlendirilen alan adında yapıldı)</p> : null}
              {r.crawl.wwwFallback ? <p><span className="text-muted">Not:</span> {view.domain} açılmadığı için www.{view.domain} incelendi. Alan adınızın www&apos;suz halini düzeltmeniz önerilir.</p> : null}
              {r.crawl.failures?.length ? <p className="text-xs text-text-secondary">Okunamayan sayfalar: {r.crawl.failures.map((f) => `${f.url} → ${f.reason}`).join("; ")}</p> : null}
              {r.unavailableEngines.length ? <p><span className="text-muted">Kullanılamayan platformlar:</span> {r.unavailableEngines.map((u) => `${ENGINE[u.engine] ?? u.engine} (${u.reason})`).join("; ")}</p> : null}
              {r.failedCalls?.length ? <p><span className="text-muted">Yanıt alınamayan çağrılar:</span> {r.failedCalls.map((f) => { const [e, c] = f.split(":"); return `${ENGINE[e!] ?? e} (${CALL_ERROR[c ?? ""] ?? c})`; }).join("; ")} — başarısız sorgular görünürlük sıfırı sayılmaz.</p> : null}
              {r.failedDetails && Object.keys(r.failedDetails).length ? (
                <ul className="text-xs text-text-secondary">
                  {Object.entries(r.failedDetails).map(([e, d]) => <li key={e} className="break-words">{ENGINE[e] ?? e}: {d}</li>)}
                </ul>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={`Fırsat sayısı: ${r.opportunityCount}`} description="Markanızın anılmadığı, başka sitelerin kaynak gösterildiği sorular. İlk 3 örnek:" />
              <ul className="divide-y divide-border">
                {r.examples.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Bu örneklemde fırsat tespit edilmedi.</li> : null}
                {r.examples.map((e, i) => (
                  <li key={i} className="px-4 py-3 text-sm">
                    <p className="font-medium">&ldquo;{e.prompt}&rdquo;</p>
                    <p className="mt-1 text-muted">{ENGINE[e.engine] ?? e.engine} · Satın almaya yakınlık {e.intentScore}/100 · Kaynak gösterilen siteler: {e.competitorDomains.join(", ")}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Rakip adayları" description="Yanıtlarda kaynak gösterilen ticari sitelerden (haber, kamu ve eğitim siteleri hariç); kayıttan sonra onaylamanız gerekir." />
              <ul className="divide-y divide-border">
                {candidates.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Aday bulunamadı.</li> : null}
                {candidates.map((c) => (
                  <li key={c.domain} className="flex justify-between px-4 py-3 text-sm">
                    <span>{c.domain}</span>
                    <span className="tabular text-muted">{c.observations} yanıtta</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHeader title="Öncelikli kontrol listesi" description="Site ve reklam hazırlığı ayrı gruplanmıştır." />
            <ul className="divide-y divide-border">
              {[...r.readiness.checks].sort((a, b) => (a.status === "fail" ? -1 : 1) - (b.status === "fail" ? -1 : 1)).map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.label} <span className="text-xs font-normal text-muted">({c.group === "geo" ? "Site" : "Reklam"})</span>
                    </p>
                    <p className="text-muted">{c.detail}</p>
                  </div>
                  {notRead && c.status !== "pass" ? <Badge>Ölçülemedi</Badge> : <Badge tone={STATUS_BADGE[c.status].tone}>{STATUS_BADGE[c.status].label}</Badge>}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Sonraki adım</h2>
            <p className="mt-1 text-sm text-muted">
              Raporu kaydetmek için doğrulanmış hesapla giriş yapın. Kayıt sonrası 7 günlük Starter denemesi (kart gerekmez) ile ilk 10 fırsatın detayını ve haftalık ölçümü açarsınız; tüm fırsat detayları ve AI ile iyileştir Growth paketindedir.
            </p>
            {claimError ? <p className="mt-2 text-sm text-danger" role="alert">{claimError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {view.claimed ? (
                <Badge tone="neutral">Bu rapor bir hesaba kaydedildi</Badge>
              ) : signedIn ? (
                <Button variant="primary" onClick={claim} disabled={claiming}>{claiming ? "Kaydediliyor…" : "Raporu hesabıma kaydet"}</Button>
              ) : (
                <Button asChild variant="primary">
                  <Link href={`/login?next=${encodeURIComponent(`/audit/${token}`)}`}>Giriş yap ve kaydet</Link>
                </Button>
              )}
              <Button asChild>
                <Link href="/pricing">Paketleri gör</Link>
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

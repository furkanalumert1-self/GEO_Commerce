"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { isCompetitorCandidate } from "@/modules/audit/competitor-filter";
import { AuditConfirm, type Proposal } from "@/components/forms/audit-confirm";
import { ENGINE_SHORT } from "@/lib/format";

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
  crawl: { pages: number; failed: number; skippedByRobots: number; products: number; categories: string[]; truncated?: boolean; failures?: Array<{ url: string; reason: string }>; siteDomain?: string | null; wwwFallback?: boolean; landedHost?: string | null };
  /** Site hiç okunamadı: puan/fırsat/rakip üretilmedi. */
  siteUnreadable?: { kind: string; detail: string; wwwTried?: boolean };
  competitorCandidates: Array<{ domain: string; observations: number }>;
  opportunityCount: number;
  examples: Array<{ prompt: string; engine: string; engines?: string[]; competitorDomains: string[]; intentScore: number; intentType: string }>;
  /** Onay aşaması (phase: confirm) alanları. */
  phase?: string;
  proposal?: Proposal;
  /** Yeni raporlar: soru türleri ve türe göre sonuçlar, fırsat analizinin yapılıp yapılamadığı, işletme türü. */
  questions?: Array<{ text: string; kind: "discovery" | "need" | "info" | null; topic?: string | null }>;
  prompts?: string[];
  kindStats?: Record<"discovery" | "need" | "info", { answers: number; mentioned: number; ownCitation: number }>;
  opportunityAnalyzed?: boolean;
  business?: { type: string; confidence: string; reasons: string[]; topics: string[] } | null;
  displayName?: string | null;
  counts?: { answers: number; mentioned: number; recommended: number; ownCitation: number };
  groups?: Array<{ label: string; area: string | null; subtype: string | null; products: string[]; evidenceUrls: string[] }>;
  scopeUnavailable?: string;
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
  queued: "Siteniz inceleniyor",
  crawling: "Siteniz inceleniyor",
  prompts: "Sorular hazırlanıyor",
  confirm: "Soruları onaylayın",
  asking_engines: "AI yanıtları kontrol ediliyor",
  summarizing: "Raporunuz hazırlanıyor",
  done: "Tamamlandı",
  failed: "Başarısız",
};

/** Gerçek iş aşamasına bağlı adımlar (sahte ilerleme yok). */
const STEPS: Array<{ label: string; stages: string[] }> = [
  { label: "Siteniz inceleniyor", stages: ["queued", "crawling"] },
  { label: "Sorular hazırlanıyor", stages: ["prompts", "confirm"] },
  { label: "AI yanıtları kontrol ediliyor", stages: ["asking_engines"] },
  { label: "Raporunuz hazırlanıyor", stages: ["summarizing"] },
];


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
  blocked: { why: (d) => `${d} açık, ancak bot koruması (Cloudflare/WAF) otomatik ziyaretimizi engelledi.`, todo: "Güvenlik duvarınızda (Cloudflare, Akamai vb.) CallypsoBot'a izin verin. Aynı koruma ChatGPT, Claude ve Perplexity tarayıcılarını (GPTBot, ClaudeBot, PerplexityBot) da engelliyorsa AI yanıtlarında sitenizin kaynak gösterilmesi zorlaşır; bunu da kontrol edin. Hesabınızda ürün dosyası (CSV) yükleyerek de devam edebilirsiniz." },
  http: { why: (d) => `${d} sayfalarını açarken hata kodu döndü.`, todo: "Ana sayfanızın tarayıcıda açıldığını kontrol edin; sorun sürerse barındırma sağlayıcınızla görüşün." },
  robots: { why: (d) => `${d} robots.txt dosyası tüm sitenin incelenmesini engelliyor.`, todo: "AI ve arama tarayıcılarının sitenizi okuyabilmesi için robots.txt'deki genel engeli kaldırın." },
  network: { why: () => "Tarama tamamlanamadı; nedeni kesin belirlenemedi.", todo: "Biraz sonra tekrar deneyin. Sorun sürerse sitenizin otomatik ziyaretleri (bot) engelleyip engellemediğini kontrol edin." },
  incomplete: { why: () => "Tarama süre sınırı içinde tamamlanamadı (site yavaş yanıt verdi).", todo: "Biraz sonra tekrar deneyin." },
};

const BUSINESS: Record<string, string> = { manufacturer: "Üretici / kendi markası", retailer: "Çok markalı mağaza", brand_store: "Kendi markası + mağaza", marketplace: "Pazaryeri", service: "Hizmet / ajans", saas: "Yazılım (SaaS)", service_saas: "Hizmet + yazılım", unknown: "Belirlenemedi" };
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
  // Geçici sunucu/bağlantı hatasında (zaman aşımı, 5xx, JSON olmayan yanıt) otomatik yeniden deneme sayacı.
  const [retries, setRetries] = useState(0);
  const router = useRouter();
  const confirming = view.stage === "confirm";
  const running = (view.status === "queued" || view.status === "running") && !confirming;

  useEffect(() => {
    if (!running || paused) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Inline: sıradaki adımı yürüt (POST). Worker modu: yalnız durumu oku (GET iş başlatmaz).
        const res = inline
          ? await fetch(`/api/v1/audits/${encodeURIComponent(token)}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" })
          : await fetch(`/api/v1/audits/${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!body || res.status >= 500 || res.status === 429) throw Object.assign(new Error("Sunucu yanıtı gecikti"), { transient: true });
        if (!res.ok) throw new Error(body?.error?.message ?? "Durum alınamadı");
        if (!cancelled) {
          setRetries(0);
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
          // Ağ hatası veya geçici sunucu hatası: tamamlanan adımlar korunur; 3 kez artan aralıkla kendiliğinden yeniden denenir.
          const transient = (e as { transient?: boolean }).transient || e instanceof TypeError;
          if (transient && retries < 3) {
            setPollError("Bağlantı yavaşladı; kaldığı yerden otomatik devam ediliyor…");
            delay.current = 5000 * (retries + 1);
            setRetries((n) => n + 1);
            return;
          }
          setPollError(transient ? "Sunucu şu anda yanıt vermiyor. Tamamlanan adımlar kayıtlı; “Devam et” ile kaldığı yerden sürdürebilirsiniz." : (e as Error).message);
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
  }, [running, token, view, inline, paused, step?.outcome, retries]);

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



  const candidates = (r?.competitorCandidates ?? []).filter((c) => isCompetitorCandidate(c.domain, view.domain));
  // Eski raporlarda site okunamadıysa (0 sayfa) kontrol maddeleri "bulunamadı" değil "ölçülemedi"dir.
  const notRead = (r?.crawl?.pages ?? 0) === 0;
  const unreadable = r?.siteUnreadable ? UNREADABLE[r.siteUnreadable.kind] ?? UNREADABLE.network! : null;
  const display = (() => {
    const n = (r?.displayName ?? r?.brandName ?? view.domain.split(".")[0] ?? view.domain).trim();
    return n ? n.charAt(0).toLocaleUpperCase("tr-TR") + n.slice(1) : view.domain;
  })();
  const checks = r?.readiness?.checks ?? [];
  const publishChecks = checks.filter((c) => c.status === "requires_verification");
  const siteChecks = checks.filter((c) => c.group === "geo");
  const adChecks = checks.filter((c) => c.group === "ads" && c.status !== "requires_verification");
  const tally = (list: Check[]) => ({ pass: list.filter((c) => c.status === "pass").length, fail: list.filter((c) => c.status === "fail").length, review: list.filter((c) => c.status === "not_detected").length });
  const tallyText = (t: { pass: number; fail: number; review: number }, okWord: string) =>
    [t.pass ? `${t.pass} kontrol ${okWord}` : null, t.fail ? `${t.fail} sorun` : null, t.review ? `${t.review} kontrol öneriliyor` : null].filter(Boolean).join(" · ") || "Kontrol yapılamadı";
  const checkView = (c: Check): { label: string; badge: string; tone: "success" | "danger" | "neutral" | "warning"; detail: string } => {
    if (notRead && c.status !== "pass") return { label: c.label, badge: "Ölçülemedi", tone: "neutral", detail: c.detail };
    if (c.id === "policy_pages" && c.status === "not_detected") return { label: "Politika bağlantılarını kontrol edin", badge: "Kontrol edin", tone: "warning", detail: "İade/gizlilik bağlantısı taranan sayfalarda bulunamadı; bulunamaması sayfanın olmadığını kanıtlamaz." };
    if (c.id === "measurement" && c.status === "pass") return { label: "Ölçüm etiketi bulundu", badge: "Etiket bulundu", tone: "success", detail: `${c.detail}. Etiketin doğru çalıştığı bu taramada doğrulanmadı.` };
    if (c.status === "fail") return { label: c.label, badge: "Sorun var", tone: "danger", detail: c.detail };
    if (c.status === "not_detected") return { label: c.label, badge: "Kontrol edin", tone: "warning", detail: c.detail };
    if (c.status === "requires_verification") return { label: c.label, badge: "Taramada doğrulanmaz", tone: "neutral", detail: c.detail };
    return { label: c.label, badge: "Geçti", tone: "success", detail: c.detail };
  };
  const missing = r?.visibility?.missingEngines ?? [];
  const componentIssues = [
    missing.length ? `${(r?.crawl?.pages ?? 0) > 0 ? "Site kontrolü hazır; " : ""}${missing.map((e) => ENGINE_SHORT[e] ?? e).join(", ")} yanıtları alınamadı.` : null,
    r?.crawl?.failed ? `${r.crawl.failed} sayfa okunamadı.` : null,
  ].filter(Boolean) as string[];
  const discoveryAnswers = r?.kindStats ? r.kindStats.discovery.answers + r.kindStats.need.answers : null;
  const discoveryMentioned = r?.kindStats ? r.kindStats.discovery.mentioned + r.kindStats.need.mentioned : null;
  // En fazla 3 kanıtlı sonraki adım: görünürlük açığı, sorunlu kontroller, önerilen kontroller.
  const nextSteps: Array<{ title: string; evidence: string }> = [];
  if (discoveryAnswers && discoveryMentioned !== null && discoveryMentioned < discoveryAnswers / 2) {
    const domains = [...new Set((r?.examples ?? []).flatMap((e) => e.competitorDomains))].slice(0, 3);
    nextSteps.push({ title: discoveryMentioned === 0 ? `AI yanıtlarında ${display} anılmadı` : `${display} yanıtların azında anıldı`, evidence: `${discoveryAnswers} keşif/ihtiyaç yanıtının ${discoveryMentioned}'inde anıldınız${domains.length ? `; kaynak gösterilenler: ${domains.join(", ")}` : ""}. Bu ürün grupları için içerik ve kaynak fırsatlarını hesabınızda inceleyin.` });
  }
  for (const c of checks.filter((x) => x.status === "fail")) nextSteps.push({ title: checkView(c).label, evidence: c.detail });
  for (const c of checks.filter((x) => x.status === "not_detected")) nextSteps.push({ title: checkView(c).label, evidence: checkView(c).detail });
  const groupsText = (r?.groups?.length ? r.groups.map((g) => g.label) : r?.business?.topics ?? []).join(", ");
  const qCount = (r?.questions ?? r?.prompts ?? []).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{r?.visibility || r?.scopeUnavailable ? `${display} — AI Görünürlük Ön Analizi` : `Ücretsiz ölçüm: ${view.domain}`}</h1>
        {r?.demo ? <Badge tone="warning">Örnek veri</Badge> : null}
        <Badge tone={view.status === "failed" ? "danger" : componentIssues.length && !running ? "warning" : view.status === "succeeded" || view.status === "partial" ? "success" : "primary"}>
          {r?.siteUnreadable ? "İncelenemedi" : view.status === "failed" ? "Başarısız" : running || confirming ? (STAGES[view.stage] ?? view.stage) : componentIssues.length ? "Kısmen tamamlandı" : "Tamamlandı"}
        </Badge>
      </div>
      {r?.visibility || r?.scopeUnavailable ? <p className="-mt-4 text-sm text-text-secondary">{view.domain}</p> : null}

      {running ? (
        <Card className="p-5" aria-live="polite">
          <ol className="flex flex-col gap-2">
            {STEPS.map((st, i) => {
              const current = STEPS.findIndex((x) => x.stages.includes(view.stage));
              const state = current === -1 ? "todo" : i < current ? "done" : i === current ? "now" : "todo";
              return (
                <li key={st.label} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${state === "done" ? "bg-success text-white" : state === "now" ? "bg-primary text-white" : "bg-bg text-muted"}`}>{state === "done" ? "✓" : i + 1}</span>
                  <span className={state === "now" ? "font-medium" : state === "todo" ? "text-muted" : ""}>{st.label}</span>
                  {state === "now" && view.stage === "asking_engines" && step?.progress && step.progress.total > 0 ? <span className="tabular text-text-secondary">({step.progress.done}/{step.progress.total} yanıt)</span> : null}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted">
            {inline
              ? "Analiz bu sekme açıkken ilerler; sekme kapatılırsa duraklar, bağlantıya geri döndüğünüzde kaldığı yerden devam eder."
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
                    setRetries(0);
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
          <p className="font-semibold">{["network", "incomplete"].includes(r.siteUnreadable.kind) ? "Tarama tamamlanamadı" : "Siteniz incelenemedi"}; bu yüzden görünürlük puanı ve öneri hesaplamadık.</p>
          <p className="mt-1">{unreadable.why(view.domain)}</p>
          <p className="mt-2 text-sm"><span className="font-semibold">Ne yapmalı? </span>{unreadable.todo}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="primary"><Link href="/audit">Tekrar dene</Link></Button>
          </div>
          <details className="mt-3 text-xs text-text-secondary">
            <summary className="cursor-pointer">Teknik ayrıntı</summary>
            <p className="mt-1 break-words">{r.siteUnreadable.detail}</p>
          </details>
          <p className="mt-3 text-xs text-text-secondary">Veri üretmeyen ölçüm ücretsiz hakkınızı tüketmez.</p>
        </div>
      ) : view.status === "failed" ? (
        <Alert tone="danger" title="Ölçüm tamamlanamadı">
          Siteniz okunamadı ve AI platformlarından yanıt alınamadı. Veri üretmeyen ölçüm ücretsiz hakkınızı tüketmez; biraz sonra tekrar deneyebilirsiniz.
        </Alert>
      ) : null}

      {confirming && r?.proposal ? (
        <AuditConfirm
          token={token}
          proposal={r.proposal}
          scopeEngines={r.scopeEngines ?? []}
          unavailable={r.unavailableEngines ?? []}
          pages={r.crawl?.pages ?? 0}
          products={r.crawl?.products ?? 0}
          onConfirmed={(v) => {
            setStep(null);
            setPaused(false);
            setView(v as View);
          }}
        />
      ) : null}

      {r?.scopeUnavailable ? (
        <Card className="p-5">
          <h2 className="font-semibold">Görünürlük kapsamı oluşturulamadı</h2>
          <p className="mt-1 text-sm text-text-secondary">{r.scopeUnavailable} Güvenilir olmayan genel sorularla puan üretmedik; AI platformlarına soru sorulmadı. Aşağıda doğrulanabilen site kontrolleri var.</p>
          <div className="mt-3"><Button asChild><Link href="/audit">Tekrar dene</Link></Button></div>
        </Card>
      ) : null}

      {r && !r.siteUnreadable && r.visibility ? (
        <>
          {componentIssues.length ? (
            <Alert tone="warning" title="Kısmen tamamlandı">{componentIssues.join(" ")}</Alert>
          ) : null}

          {!r.scopeUnavailable ? (
            <p className="text-sm text-text-secondary" data-testid="report-scope">
              Sitenizden seçilen {r.groups?.length || r.business?.topics.length || 0} ürün grubu{groupsText ? ` (${groupsText})` : ""} ve {qCount} soru üzerinden hazırlanmıştır; tüm ürünlerinizi kapsamaz.
            </p>
          ) : null}
          {r.crawl.landedHost ? (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm" data-testid="report-landed">
              {view.domain} bizi <span className="font-semibold">{r.crawl.landedHost}</span> adresine yönlendirdi (muhtemelen ülkeye göre yönlendirme). İncelenen sayfalar bu adrestendir; {r.provenance?.country ?? "hedef"} pazarındaki sitenizden farklı olabilir. Ülkeye göre yönlendirme yapıyorsanız tarayıcımızın hedef ülke sitenize erişebildiğinden emin olun veya ülke sitenizin tam adresini girin.
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            {!r.scopeUnavailable ? (
              <Card className="p-4">
                <p className="text-sm text-muted">AI görünürlük puanı</p>
                <p className="tabular mt-2 text-3xl font-semibold">{r.visibility.sampleCount > 0 && r.visibility.score !== null ? <>{r.visibility.score}<span className="text-base font-normal text-muted"> / 100</span></> : "Ölçülemedi"}</p>
                <p className="tabular mt-2 text-xs text-muted">{qCount} farklı soru · {r.visibility.sampleCount} geçerli yanıt</p>
                {r.counts ? <p className="tabular mt-1 text-xs text-muted">Anılma {r.counts.mentioned} · Önerilme {r.counts.recommended} · Kendi sayfanız kaynak {r.counts.ownCitation} (yanıt sayısı)</p> : null}
                <p className="mt-1 text-xs text-muted">Puan yüzde değildir: anılma, önerilme ve kendi sayfanızın kaynak gösterilmesinin ağırlıklı ölçüsüdür. Küçük örneklem.</p>
              </Card>
            ) : null}
            <Card className="p-4">
              <p className="text-sm text-muted">Site kontrolleri</p>
              <p className="mt-2 text-lg font-semibold">{tallyText(tally(siteChecks), "geçti")}</p>
              <p className="mt-2 text-xs text-muted">Görünürlük puanından ayrıdır; genel bir “hazır” notu değildir.</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">Reklam için site kontrolleri</p>
              <p className="mt-2 text-lg font-semibold">{tallyText(tally(adChecks), "olumlu")}</p>
              {publishChecks.length ? <p className="mt-2 text-xs text-muted">Yayın öncesi {publishChecks.length} kontrol (hesap uygunluğu, ödeme akışı) site taramasında doğrulanmaz.</p> : null}
            </Card>
          </div>

          {nextSteps.length ? (
            <Card>
              <CardHeader title="Öne çıkan bulgular ve sonraki adımlar" />
              <ol className="divide-y divide-border">
                {nextSteps.slice(0, 3).map((n, i) => (
                  <li key={i} className="px-4 py-3 text-sm sm:px-6">
                    <p className="font-medium">{i + 1}. {n.title}</p>
                    <p className="mt-0.5 text-text-secondary">{n.evidence}</p>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          {!r.scopeUnavailable ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                {r.opportunityAnalyzed === false || r.visibility.sampleCount === 0 ? (
                  <CardHeader title="Fırsat analizi yapılamadı" description="Keşif/ihtiyaç sorularında geçerli yanıt alınamadı; bu “fırsat yok” anlamına gelmez." />
                ) : (
                  <>
                    <CardHeader title={`Fırsat sinyali: ${r.opportunityCount} soru`} description="Keşif/ihtiyaç sorularında markanız anılmadı ve ticari bir site kaynak gösterildi. Kesin fırsat için kayıttan sonra kanıt incelenir." />
                    <ul className="divide-y divide-border">
                      {r.examples.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Bu örneklemde fırsat sinyali görülmedi.</li> : null}
                      {r.examples.map((e, i) => (
                        <li key={i} className="px-4 py-3 text-sm">
                          <p className="font-medium">&ldquo;{e.prompt}&rdquo;</p>
                          <p className="mt-1 text-muted">{(e.engines ?? [e.engine]).map((x) => ENGINE[x] ?? x).join(", ")} · Kaynak gösterilen siteler: {e.competitorDomains.join(", ") || "—"}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
              <Card>
                <CardHeader title="Rakip adayları" description="Yanıtlarda kaynak gösterilen ticari siteler (haber, kamu, eğitim ve liste siteleri hariç); kayıttan sonra onaylamanız gerekir." />
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
          ) : null}

          <Card>
            <CardHeader title="Site kontrolleri" description="Sorun ve öneriler önce; geçen kontroller kapalı bölümde." />
            <ul className="divide-y divide-border">
              {checks.filter((c) => c.status === "fail" || c.status === "not_detected").map((c) => {
                const v = checkView(c);
                return (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{v.label} <span className="text-xs font-normal text-muted">({c.group === "geo" ? "Site" : "Reklam"})</span></p>
                      <p className="text-muted">{v.detail}</p>
                    </div>
                    <Badge tone={v.tone}>{v.badge}</Badge>
                  </li>
                );
              })}
            </ul>
            <details className="border-t border-border px-4 py-3 text-sm">
              <summary className="min-h-9 cursor-pointer py-1 font-medium text-primary">Geçen kontroller ({checks.filter((c) => c.status === "pass").length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {checks.filter((c) => c.status === "pass").map((c) => {
                  const v = checkView(c);
                  return (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
                      <span><span className="font-medium">{v.label}</span> <span className="text-muted">— {v.detail}</span></span>
                      <Badge tone={v.tone}>{v.badge}</Badge>
                    </li>
                  );
                })}
              </ul>
            </details>
            {publishChecks.length ? (
              <div className="border-t border-border px-4 py-3 text-sm">
                <p className="font-medium">Yayın öncesi kontroller</p>
                <p className="text-text-secondary">Reklam hesabı uygunluğu ve ödeme akışı site taramasında doğrulanmaz; reklam platformunda kontrol edin.</p>
                <ul className="mt-1 list-disc pl-5 text-text-secondary">{publishChecks.map((c) => <li key={c.id}>{c.label}</li>)}</ul>
              </div>
            ) : null}
          </Card>

          <details className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-3 text-sm">
            <summary className="min-h-9 cursor-pointer py-1 font-medium text-primary">Sorular, ürün grupları ve yöntem</summary>
            <div className="mt-3 flex flex-col gap-3">
              {r.questions?.length ? (
                <div>
                  <p className="font-medium">Sorulan sorular</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {r.questions.map((q) => <li key={q.text}><span className="text-xs text-muted">[{q.kind === "info" ? "Bilgi" : q.kind === "need" ? "İhtiyaç" : "Keşif"}]</span> {q.text}</li>)}
                  </ul>
                </div>
              ) : null}
              {r.groups?.length ? (
                <div>
                  <p className="font-medium">Ürün grupları (tarama kanıtı)</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {r.groups.map((g) => (
                      <li key={g.label}>
                        {[g.area, g.label, g.subtype].filter(Boolean).join(" → ")}
                        <span className="block text-xs text-muted [overflow-wrap:anywhere]">Örnek ürünler: {g.products.slice(0, 3).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="grid gap-1 sm:grid-cols-2">
                <p><span className="text-muted">Yöntem:</span> web aramalı API yanıtları; ChatGPT/Gemini/Claude uygulamasındaki sonuçla birebir aynı değildir</p>
                {r.business ? <p><span className="text-muted">İşletme türü (tahmin):</span> {BUSINESS[r.business.type] ?? r.business.type}</p> : null}
                {r.scopeEngines?.length ? <p><span className="text-muted">Platformlar:</span> {r.scopeEngines.map((e) => ENGINE[e] ?? e).join(", ")}</p> : null}
                <p><span className="text-muted">Ülke / dil (istenen pazar):</span> {r.provenance.country} / {r.provenance.language}</p>
                <p><span className="text-muted">Modeller:</span> {r.provenance.models.join(", ") || "—"}</p>
                <p><span className="text-muted">Tarih:</span> {new Date(r.provenance.sampledAt).toLocaleString("tr-TR")}</p>
                <p><span className="text-muted">Site incelemesi:</span> {r.crawl.pages} sayfa okundu, {r.crawl.products} ürün bulundu{r.crawl.failed ? `, okunamayan ${r.crawl.failed}` : ""}{r.crawl.truncated ? " (hızlı analiz: sınırlı tarama)" : ""}</p>
                {r.crawl.siteDomain ? <p><span className="text-muted">Yönlendirme:</span> {view.domain} → {r.crawl.siteDomain}</p> : null}
                {r.crawl.wwwFallback ? <p><span className="text-muted">Not:</span> {view.domain} açılmadığı için www.{view.domain} incelendi.</p> : null}
                {r.crawl.failures?.length ? <p className="text-xs text-text-secondary [overflow-wrap:anywhere]">Okunamayan sayfalar: {r.crawl.failures.map((f) => `${f.url} → ${f.reason}`).join("; ")}</p> : null}
                {r.unavailableEngines.length ? <p><span className="text-muted">Kullanılamayan platformlar:</span> {r.unavailableEngines.map((u) => `${ENGINE[u.engine] ?? u.engine} (${u.reason})`).join("; ")}</p> : null}
                {r.failedCalls?.length ? <p><span className="text-muted">Yanıt alınamayan çağrılar:</span> {r.failedCalls.map((f) => { const [e, c] = f.split(":"); return `${ENGINE[e!] ?? e} (${CALL_ERROR[c ?? ""] ?? c})`; }).join("; ")} — başarısız sorgular puana sıfır olarak girmez.</p> : null}
                {r.failedDetails && Object.keys(r.failedDetails).length ? (
                  <ul className="text-xs text-text-secondary">
                    {Object.entries(r.failedDetails).map(([e, d]) => <li key={e} className="break-words">{ENGINE[e] ?? e}: {d}</li>)}
                  </ul>
                ) : null}
              </div>
            </div>
          </details>

          <Card className="p-5">
            <h2 className="font-semibold">Kategori ve ürünlerinizi ayrıntılı takip edin</h2>
            <p className="mt-1 text-sm text-muted">
              Raporu hesabınıza kaydedin: sonuçlar yeniden üretilmeden aktarılır. 7 günlük Starter denemesiyle (kart gerekmez) kendi kategori ve sorularınızı seçip düzenli ölçüm yapabilirsiniz.
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

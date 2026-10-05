"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { blockingIssues, lineDiff, toMarkdown, validateJsonLd, type ActionContent } from "@/modules/actions/workflow";
import { ContentPreview } from "@/components/data/content-preview";

const STAGE_TITLE: Record<string, string> = {
  draft: "Taslak · sonraki adım",
  review: "İnceleme bekliyor",
  approved: "Sitenize uygulayın",
  publishing: "Yayınlanıyor",
  published: "Yayınlandı · sonucu izlemeye hazır",
  measuring: "Sonuç izleniyor",
  completed: "İzleme tamamlandı",
  failed: "Yayın başarısız",
  rejected: "Reddedildi",
  rolled_back: "Geri alındı",
};

interface Version {
  id: string;
  number: number;
  contentHash: string;
  content: ActionContent;
  generated: boolean;
  createdAt: string;
}

/**
 * Split diff editörü: düzenle (yeni immutable sürüm), sürüm geri yükle, JSON-LD doğrula, export,
 * incelemeye gönder / onayla (hash'li) / reddet / yayın veya manuel yayın sonrası ölçüme al.
 * Kaydedilmemiş değişiklikte sayfadan ayrılma uyarısı; eşzamanlılık çatışmasında yeniden yükleme.
 */
export function ActionEditor({
  api,
  action,
  versions,
  approved,
  permissions,
  canPublishReason,
  integrationsHref,
  setupHref,
}: {
  api: string;
  action: { id: string; status: string; version: number; currentVersionId: string | null; targetUrl: string | null };
  versions: Version[];
  approved: boolean;
  permissions: { edit: boolean; approve: boolean; publish: boolean; export: boolean };
  canPublishReason: string | null;
  integrationsHref?: string;
  /** Katalog boşsa eksik bilgileri tamamlama yeri (kurulum). */
  setupHref?: string;
}) {
  const router = useRouter();
  const current = versions.find((v) => v.id === action.currentVersionId) ?? versions[0]!;
  const [compareId, setCompareId] = useState(versions[1]?.id ?? current.id);
  const [draft, setDraft] = useState<ActionContent>(current.content);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [pane, setPane] = useState<"preview" | "edit" | "tech">("preview");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; conflict?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const editable = permissions.edit && ["draft", "review", "approved", "rejected", "failed", "rolled_back"].includes(action.status);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const compare = versions.find((v) => v.id === compareId) ?? current;
  const diff = useMemo(() => lineDiff(toMarkdown(compare.content), toMarkdown(dirty ? draft : current.content)), [compare, draft, dirty, current]);
  const visible = [draft.title, ...draft.bodyBlocks.map((b) => b.markdown), ...draft.faq.map((f) => `${f.q} ${f.a}`)].join(" ");
  const ldIssues = draft.jsonLd ? validateJsonLd(draft.jsonLd, visible) : [];

  const call = async (url: string, body: unknown, okText: string, method = "POST") => {
    setPending(true);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setMsg({ tone: "err", text: `${json?.error?.message ?? "İşlem başarısız"}${json?.requestId ? ` · istek no: ${json.requestId}` : ""}`, conflict: res.status === 409 });
      return false;
    }
    setMsg({ tone: "ok", text: okText });
    setDirty(false);
    router.refresh();
    return true;
  };

  // SSS düzenlenince FAQPage JSON-LD görünür metinle senkron tutulur.
  const setFaq = (i: number, patch: Partial<{ q: string; a: string }>) => {
    setDraft((d) => {
      const faq = d.faq.map((f, j) => (j === i ? { ...f, ...patch } : f));
      const ld = d.jsonLd && d.jsonLd["@type"] === "FAQPage" ? { ...d.jsonLd, mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } : d.jsonLd;
      return { ...d, faq, jsonLd: ld };
    });
    setDirty(true);
  };

  const setBlock = (i: number, markdown: string) => {
    setDraft((d) => ({ ...d, bodyBlocks: d.bodyBlocks.map((b, j) => (j === i ? { ...b, markdown } : b)) }));
    setDirty(true);
  };

  const added = diff.filter((l) => l.type === "added").length;
  const removed = diff.filter((l) => l.type === "removed").length;
  const firstVersion = versions.length < 2;
  // Zorunlu eksikler kayıtlı güncel sürümden (onay/yayın bunu kullanır) ve düzenlenen taslaktan ayrı hesaplanır.
  const savedIssues = blockingIssues(current.content);
  const draftIssues = blockingIssues(draft);
  const blocked = savedIssues.length > 0;
  // Bir yer tutucuya atıf yapan not, o yer tutucu içerikten kaldırıldıysa giderilmiş sayılır.
  const savedTokens = new Set(savedIssues.map((i) => i.token));
  const openNotes = current.content.placeholders.filter((n) => {
    const tokens = n.match(/\[[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 _/-]*\]/g);
    return !tokens || tokens.some((t) => savedTokens.has(t));
  });
  const approvedButBlocked = action.status === "approved" && blocked;
  const goToField = (fieldId: string) => {
    setPane("edit");
    requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
  };
  const copyHtml = async () => {
    try {
      const res = await fetch(`${api}/export?format=html&versionId=${current.id}`);
      if (!res.ok) throw new Error();
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
    } catch {
      setMsg({ tone: "err", text: "Kopyalanamadı; “HTML indir” ile dosyayı indirip içeriğini yapıştırabilirsiniz." });
    }
  };
  const exportLinks = permissions.export && !blocked ? (
    <span className="flex flex-wrap gap-2">
      {(["html", "md", "json"] as const).map((f) => (
        <a key={f} className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-[var(--shadow-card)] hover:bg-surface-subtle sm:min-h-10" href={`${api}/export?format=${f}&versionId=${current.id}`}>
          {f.toUpperCase()} indir
        </a>
      ))}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {msg ? (
        <div role={msg.tone === "err" ? "alert" : "status"} aria-live="polite" className={msg.tone === "err" ? "rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm" : "rounded-[var(--radius-lg)] border border-success/30 bg-success-soft px-4 py-3 text-sm"}>
          {msg.text}
          {msg.conflict ? (
            <Button className="ml-2" size="sm" onClick={() => router.refresh()}>
              Yeniden yükle ve farkı gör
            </Button>
          ) : null}
        </div>
      ) : null}

      {blocked ? (
        <Card className="border-danger/40 p-5 text-sm" role="region" aria-labelledby="fix-required">
          <p id="fix-required" className="font-semibold text-danger">Bu taslakta {savedIssues.length} eksik bilgi var</p>
          <p className="mt-0.5 text-text-secondary">
            Eksikler tamamlanıp yeni sürüm kaydedilmeden onay, yayın, dışa aktarma ve “sitenizde uygulandı” bildirimi yapılamaz.
            {setupHref ? <> Ürün bilgileri katalogda olmadığı için boş kaldı: <a className="font-medium text-primary underline" href={setupHref}>Ürün bilgilerini tamamla</a>.</> : null}
            {approvedButBlocked ? " Bu kayıt daha önce onaylanmış olsa da yayına hazır sayılmaz; düzenleme yeni onay gerektirir." : ""}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {savedIssues.map((i, k) => (
              <li key={`${i.fieldId}-${k}`}>
                <button type="button" className="min-h-11 text-left text-primary underline underline-offset-2 sm:min-h-0" onClick={() => goToField(i.fieldId)}>
                  {i.fieldLabel}: {i.token}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={approvedButBlocked ? "Düzeltme gerekli" : (STAGE_TITLE[action.status] ?? "Sonraki adım")} description={dirty ? "Kaydedilmemiş değişiklik var; onay ve gönderim için önce yeni sürüm olarak kaydedin." : undefined} />
        <div className="flex flex-col gap-4 p-5">
          {action.status === "approved" ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-text-secondary">Onaylı sürüm</dt>
                <dd className="tabular font-medium">v{current.number}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-text-secondary">Hedef</dt>
                <dd className="break-all font-medium">{action.targetUrl ?? "Hedef URL belirtilmedi"}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Değişiklik</dt>
                <dd className="font-medium">{firstVersion ? "İlk taslak" : <span className="tabular">v{compare.number} → v{current.number}: +{added} / −{removed} satır</span>}</dd>
              </div>
            </dl>
          ) : null}
          {action.status === "approved" && canPublishReason && !blocked && permissions.export ? (
            <ol className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-subtle p-4 text-sm">
              <li>
                <span className="font-medium">1. İçeriği alın.</span> Kopyalayın veya HTML dosyası olarak indirin.
                <span className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={pending} onClick={copyHtml}>{copied ? "Kopyalandı ✓" : "İçeriği kopyala"}</Button>
                  <a className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-subtle sm:min-h-9" href={`${api}/export?format=html&versionId=${current.id}`}>HTML indir</a>
                </span>
              </li>
              <li>
                <span className="font-medium">2. Sitenize ekleyin.</span> Mağaza panelinizde{" "}
                {action.targetUrl ? <a className="break-all text-primary underline" href={action.targetUrl} target="_blank" rel="noopener noreferrer nofollow">hedef sayfanın</a> : "hedef sayfanın"}{" "}
                açıklama/içerik alanına yapıştırıp kaydedin (HTML veya kaynak kodu görünümünde).
              </li>
              <li>
                <span className="font-medium">3. Bize bildirin.</span> Yayınladıktan sonra “Sitenizde uyguladım → sonucu izle”ye basın; etkisini aynı sorularla ölçeriz.
              </li>
            </ol>
          ) : null}
          <div className="flex flex-wrap items-start gap-2" role="toolbar" aria-label="Aksiyon işlemleri">
            {permissions.approve && (action.status === "draft" || action.status === "review") ? (
              <Button variant="primary" disabled={pending || dirty || blocked} title={blocked ? "Eksik bilgiler tamamlanmadan onaylanamaz" : undefined} onClick={() => call(`${api}/approve`, { versionId: current.id, expectedHash: current.contentHash }, "Onaylandı")}>Değişiklikleri onayla</Button>
            ) : null}
            {permissions.edit && action.status === "draft" ? <Button variant={permissions.approve ? "secondary" : "primary"} disabled={pending || dirty} onClick={() => call(`${api}/transition`, { to: "review" }, "İncelemeye gönderildi")}>İncelemeye gönder</Button> : null}
            {permissions.approve && (action.status === "draft" || action.status === "review") ? <Button variant="danger" disabled={pending} onClick={() => call(`${api}/transition`, { to: "rejected" }, "Reddedildi")}>Reddet</Button> : null}
            {action.status === "approved" && permissions.publish ? (
              <Button variant={canPublishReason || blocked ? "secondary" : "primary"} disabled={pending || blocked || Boolean(canPublishReason)} onClick={() => call(`${api}/publish`, {}, "Yayın kuyruğa alındı")}>Mağazada yayımla</Button>
            ) : null}
            {action.status === "approved" && permissions.approve ? <Button variant={canPublishReason && !blocked ? "primary" : "secondary"} disabled={pending || blocked} onClick={() => call(`${api}/transition`, { to: "measuring" }, "Uygulama bildiriminiz kaydedildi; sonuç izleniyor")}>Sitenizde uyguladım → sonucu izle</Button> : null}
            {action.status === "published" && permissions.approve ? <Button variant="primary" disabled={pending} onClick={() => call(`${api}/transition`, { to: "measuring" }, "Sonuç izlemeye alındı")}>Sonucu izlemeye başla</Button> : null}
            {action.status === "publishing" ? <Button disabled={pending} onClick={() => router.refresh()}>Durumu yenile</Button> : null}
            {action.status === "measuring" && permissions.approve ? <Button disabled={pending} onClick={() => call(`${api}/transition`, { to: "completed" }, "Tamamlandı")}>İzlemeyi tamamla</Button> : null}
            {(action.status === "rejected" || action.status === "rolled_back") && permissions.edit ? <Button variant="primary" disabled={pending} onClick={() => call(`${api}/transition`, { to: "draft" }, "Taslağa döndü")}>Taslağa döndür</Button> : null}
          </div>
          {blocked && (action.status === "draft" || action.status === "review" || action.status === "approved") ? (
            <p className="text-sm text-text-secondary"><span className="font-medium text-text">Onay ve uygulama kapalı:</span> önce yukarıdaki zorunlu alanları doldurup yeni sürüm olarak kaydedin.</p>
          ) : null}
          {action.status === "approved" && canPublishReason && !blocked ? (
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text">Mağazada yayımlama kullanılamıyor:</span> {canPublishReason}.{" "}
              {integrationsHref ? <a className="text-primary underline" href={integrationsHref}>Entegrasyonları yönet</a> : null}
            </p>
          ) : null}
          {action.status === "approved" ? (
            <p className="text-xs text-text-secondary">Onaylamak içeriği yayınlamaz. “Sitenizde uygulandı” sizin bildiriminizdir; doğrulanmış mağaza yayını değildir.</p>
          ) : null}
          {approved ? (
            <details className="text-xs text-text-secondary">
              <summary className="inline-flex min-h-11 cursor-pointer items-center sm:min-h-0">Teknik detaylar</summary>
              <p className="mt-1 break-all">Onay, v{current.number} sürümüne bağlı (içerik özeti {current.contentHash.slice(0, 16)}…). Düzenleme onayı düşürür.</p>
            </details>
          ) : null}
        </div>
      </Card>

      {openNotes.length ? (
        <Card className="border-warning/40 p-5 text-sm">
          <p className="font-medium">İnceleme notları ({openNotes.length})</p>
          <p className="mt-0.5 text-text-secondary">Bilgilendirici; tek başına onayı engellemez. AI metnindeki iddiaları, ürün özelliklerini ve kaynakları kontrol edin.</p>
          <ul className="mt-2 list-disc pl-5 text-text-secondary">{openNotes.map((p) => <li key={p}>{p}</li>)}</ul>
        </Card>
      ) : null}

      <div className="flex gap-1 rounded-[var(--radius-md)] bg-surface-subtle p-1" role="tablist" aria-label="Görünüm">
        {(["preview", "edit", "tech"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pane === k}
            aria-controls={`pane-${k}`}
            onClick={() => setPane(k)}
            className={pane === k ? "min-h-11 min-w-0 flex-1 rounded-[8px] px-2 leading-tight bg-surface text-sm font-medium shadow-[var(--shadow-card)] ring-1 ring-border sm:min-h-10" : "min-h-11 min-w-0 flex-1 rounded-[8px] px-2 leading-tight text-sm text-text-secondary sm:min-h-10"}
          >
            {k === "preview" ? "Önizleme" : k === "edit" ? (editable ? "Düzenle" : "Metin") : "Teknik ayrıntılar"}
          </button>
        ))}
      </div>

      <Card id="pane-preview" className={pane === "preview" ? "p-5 sm:p-6" : "hidden"}>
        <ContentPreview content={dirty ? draft : current.content} />
        {dirty ? <p className="mt-4 text-xs text-warning">Kaydedilmemiş değişiklikler önizlemede gösteriliyor.</p> : null}
      </Card>

      <div className={pane === "edit" ? "" : "hidden"}>
        <Card id="pane-edit">
          <CardHeader
            title="Önerilen içerik"
            description={`Güncel: v${current.number}${current.generated ? " (AI taslağı)" : ""}${editable ? "" : " · salt okunur"}`}
            action={editable ? <Button variant="primary" size="sm" disabled={!dirty || pending} onClick={() => call(api, { version: action.version, content: draft }, "Taslak kaydedildi (yeni sürüm)", "PATCH")}>Yeni sürüm olarak kaydet</Button> : undefined}
          />
          <div className="flex flex-col gap-3 p-5">
            <Field label="Başlık" htmlFor="a-title">
              <input id="a-title" className={inputClass} disabled={!editable} value={draft.title ?? ""} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }} />
            </Field>
            <Field label="Meta açıklama" htmlFor="a-meta">
              <textarea id="a-meta" rows={2} className={`${inputClass} py-2`} disabled={!editable} value={draft.metaDescription ?? ""} onChange={(e) => { setDraft({ ...draft, metaDescription: e.target.value }); setDirty(true); }} />
            </Field>
            {draft.bodyBlocks.map((b, i) => (
              <Field key={i} label={b.heading ?? `Blok ${i + 1}`} htmlFor={`a-block-${i}`}>
                <textarea id={`a-block-${i}`} rows={6} className={`${inputClass} py-2 font-mono text-xs leading-relaxed`} disabled={!editable} value={b.markdown} onChange={(e) => setBlock(i, e.target.value)} />
              </Field>
            ))}
            {draft.faq.map((f, i) => (
              <fieldset key={`faq-${i}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">SSS {i + 1}</legend>
                <Field label="Soru" htmlFor={`a-faq-${i}-q`}>
                  <input id={`a-faq-${i}-q`} className={inputClass} disabled={!editable} value={f.q} onChange={(e) => setFaq(i, { q: e.target.value })} />
                </Field>
                <Field label="Yanıt" htmlFor={`a-faq-${i}-a`}>
                  <textarea id={`a-faq-${i}-a`} rows={3} className={`${inputClass} py-2`} disabled={!editable} value={f.a} onChange={(e) => setFaq(i, { a: e.target.value })} />
                </Field>
              </fieldset>
            ))}
            {editable && draftIssues.length ? <p className="text-xs text-danger" role="status">Taslakta {draftIssues.length} doldurulmamış yer tutucu var ({[...new Set(draftIssues.map((d) => d.token))].join(", ")}).</p> : null}
          </div>
        </Card>
      </div>
      <div id="pane-tech" className={pane === "tech" ? "flex flex-col gap-6" : "hidden"}>
        <p className="text-sm text-text-secondary">Uzmanlar için: sürüm karşılaştırması, dışa aktarma ve yapılandırılmış veri kontrolü.</p>
        {exportLinks}
        <Card>
          <CardHeader
            title="Sürüm farkı"
            description={firstVersion ? undefined : `+${added} eklenen / −${removed} silinen satır`}
            action={firstVersion ? undefined :
              <label className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">Karşılaştır:</span>
                <select className="min-h-11 rounded-md border border-border-strong/60 bg-surface px-2 sm:min-h-8" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.number}</option>)}
                </select>
              </label>
            }
          />
          {firstVersion ? (
            <p className="p-5 text-sm text-text-secondary">İlk taslak; karşılaştırılacak önceki sürüm yok. Hedef sayfanın mevcut içeriği bu ekrana aktarılmadığından “mevcut → önerilen” karşılaştırması gösterilmiyor.</p>
          ) : (
          <div className="max-h-[36rem] overflow-auto p-5 font-mono text-xs leading-relaxed" aria-label="Satır farkı" role="region" tabIndex={0}>
            {diff.map((l, i) => (
              <div key={i} className={l.type === "added" ? "rounded-sm bg-success-soft" : l.type === "removed" ? "rounded-sm bg-danger-soft line-through" : ""}>
                <span aria-hidden className="inline-block w-4 select-none text-text-secondary">{l.type === "added" ? "+" : l.type === "removed" ? "−" : " "}</span>
                <span className="sr-only">{l.type === "added" ? "eklendi: " : l.type === "removed" ? "silindi: " : ""}</span>
                {l.text || " "}
              </div>
            ))}
          </div>
          )}
        </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Yapılandırılmış veri (JSON-LD) kontrolü" description="Biçim kontrolüdür; arama sonucunda zengin görünüm veya AI'da kaynak gösterilme garantisi değildir." />
          <div className="p-5 text-sm">
            {!draft.jsonLd ? <p className="text-text-secondary">Bu aksiyonda JSON-LD yok.</p> : ldIssues.length === 0 ? <Badge tone="success">Sorun bulunmadı; SSS görünür metinle uyumlu</Badge> : (
              <ul className="flex flex-col gap-1">{ldIssues.map((i, k) => <li key={k}><Badge tone={i.severity === "error" ? "danger" : "warning"}>{i.path}</Badge> {i.message}</li>)}</ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Kaynaklar ve sürümler" />
          <div className="flex flex-col gap-3 p-5 text-sm">
            <ul className="list-disc pl-5">{current.content.sources.length ? current.content.sources.map((s) => <li key={s.url}><a className="break-all text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.url}</a>{s.note ? ` — ${s.note}` : ""}</li>) : <li className="text-text-secondary">Kaynak yok</li>}</ul>
            <ul className="divide-y divide-border rounded-md border border-border">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>v{v.number} · {new Date(v.createdAt).toLocaleString("tr-TR")} {v.id === current.id ? <Badge tone="primary">Güncel</Badge> : null}</span>
                  {editable && v.id !== current.id ? <Button disabled={pending} onClick={() => call(api, { version: action.version, content: v.content }, `v${v.number} yeni sürüm olarak geri yüklendi`, "PATCH")}>Geri yükle</Button> : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}

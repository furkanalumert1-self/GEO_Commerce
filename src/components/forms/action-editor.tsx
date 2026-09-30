"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { lineDiff, toMarkdown, validateJsonLd, type ActionContent } from "@/modules/actions/workflow";

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
}: {
  api: string;
  action: { id: string; status: string; version: number; currentVersionId: string | null; targetUrl: string | null };
  versions: Version[];
  approved: boolean;
  permissions: { edit: boolean; approve: boolean; publish: boolean; export: boolean };
  canPublishReason: string | null;
}) {
  const router = useRouter();
  const current = versions.find((v) => v.id === action.currentVersionId) ?? versions[0]!;
  const [compareId, setCompareId] = useState(versions[1]?.id ?? current.id);
  const [draft, setDraft] = useState<ActionContent>(current.content);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; conflict?: boolean } | null>(null);
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

  const setBlock = (i: number, markdown: string) => {
    setDraft((d) => ({ ...d, bodyBlocks: d.bodyBlocks.map((b, j) => (j === i ? { ...b, markdown } : b)) }));
    setDirty(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Aksiyon işlemleri">
        {editable ? <Button variant="primary" disabled={!dirty || pending} onClick={() => call(api, { version: action.version, content: draft }, "Yeni sürüm kaydedildi", "PATCH")}>Yeni sürüm olarak kaydet</Button> : null}
        {permissions.edit && action.status === "draft" ? <Button disabled={pending || dirty} onClick={() => call(`${api}/transition`, { to: "review" }, "İncelemeye gönderildi")}>İncelemeye gönder</Button> : null}
        {permissions.approve && (action.status === "draft" || action.status === "review") ? (
          <Button variant="primary" disabled={pending || dirty} onClick={() => call(`${api}/approve`, { versionId: current.id, expectedHash: current.contentHash }, "Onaylandı")}>Bu sürümü onayla</Button>
        ) : null}
        {permissions.approve && (action.status === "draft" || action.status === "review") ? <Button variant="danger" disabled={pending} onClick={() => call(`${api}/transition`, { to: "rejected" }, "Reddedildi")}>Reddet</Button> : null}
        {action.status === "approved" && permissions.publish ? (
          <span className="flex flex-col gap-1">
            <Button disabled={pending || Boolean(canPublishReason)} onClick={() => call(`${api}/publish`, {}, "Yayın kuyruğa alındı")}>Mağazada yayımla</Button>
            {canPublishReason ? <span className="text-xs text-muted">{canPublishReason}</span> : null}
          </span>
        ) : null}
        {action.status === "approved" && permissions.approve ? <Button disabled={pending} onClick={() => call(`${api}/transition`, { to: "measuring" }, "Manuel yayın kaydedildi; ölçüm başladı")}>Manuel yayımlandı → ölçüme al</Button> : null}
        {action.status === "measuring" && permissions.approve ? <Button disabled={pending} onClick={() => call(`${api}/transition`, { to: "completed" }, "Tamamlandı")}>Ölçümü tamamla</Button> : null}
        {(action.status === "rejected" || action.status === "rolled_back") && permissions.edit ? <Button disabled={pending} onClick={() => call(`${api}/transition`, { to: "draft" }, "Taslağa döndü")}>Taslağa döndür</Button> : null}
        {permissions.export ? (
          <span className="flex flex-wrap gap-2">
            {(["html", "md", "json"] as const).map((f) => (
              <a key={f} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-bg sm:min-h-9" href={`${api}/export?format=${f}&versionId=${current.id}`}>
                {f.toUpperCase()} indir
              </a>
            ))}
          </span>
        ) : null}
      </div>
      {approved ? <Badge tone="success">Güncel sürüm onaylı (hash {current.contentHash.slice(0, 10)}…). Düzenleme onayı düşürür.</Badge> : null}
      {msg ? (
        <div role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm" : "rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm"}>
          {msg.text}
          {msg.conflict ? (
            <Button className="ml-2" onClick={() => router.refresh()}>
              Yeniden yükle ve farkı gör
            </Button>
          ) : null}
        </div>
      ) : null}
      {current.content.placeholders.length ? (
        <Card className="border-warning/40 p-4 text-sm">
          <p className="font-medium">İnceleme gerekli ({current.content.placeholders.length})</p>
          <ul className="mt-1 list-disc pl-5 text-muted">{current.content.placeholders.map((p) => <li key={p}>{p}</li>)}</ul>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Düzenle" description={`Güncel: v${current.number}${current.generated ? " (AI taslağı)" : ""}`} />
          <div className="flex flex-col gap-3 p-4">
            <Field label="Başlık" htmlFor="a-title">
              <input id="a-title" className={inputClass} disabled={!editable} value={draft.title ?? ""} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }} />
            </Field>
            <Field label="Meta açıklama" htmlFor="a-meta">
              <textarea id="a-meta" rows={2} className={`${inputClass} py-2`} disabled={!editable} value={draft.metaDescription ?? ""} onChange={(e) => { setDraft({ ...draft, metaDescription: e.target.value }); setDirty(true); }} />
            </Field>
            {draft.bodyBlocks.map((b, i) => (
              <Field key={i} label={b.heading ?? `Blok ${i + 1}`} htmlFor={`a-block-${i}`}>
                <textarea id={`a-block-${i}`} rows={5} className={`${inputClass} py-2 font-mono text-xs`} disabled={!editable} value={b.markdown} onChange={(e) => setBlock(i, e.target.value)} />
              </Field>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Fark"
            action={
              <label className="flex items-center gap-2 text-sm">
                <span>Karşılaştır:</span>
                <select className="min-h-11 rounded-md border border-border px-2 sm:min-h-8" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.number}</option>)}
                </select>
              </label>
            }
          />
          <div className="max-h-[32rem] overflow-auto p-4 font-mono text-xs" aria-label="Satır farkı">
            {diff.map((l, i) => (
              <div key={i} className={l.type === "added" ? "bg-success-soft" : l.type === "removed" ? "bg-danger-soft line-through" : ""}>
                <span aria-hidden className="inline-block w-4 select-none text-muted">{l.type === "added" ? "+" : l.type === "removed" ? "−" : " "}</span>
                <span className="sr-only">{l.type === "added" ? "eklendi: " : l.type === "removed" ? "silindi: " : ""}</span>
                {l.text || " "}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="JSON-LD doğrulama" description="Yapısal kontrol; rich result veya AI citation garantisi değildir." />
          <div className="p-4 text-sm">
            {!draft.jsonLd ? <p className="text-muted">Bu aksiyonda JSON-LD yok.</p> : ldIssues.length === 0 ? <Badge tone="success">Sorun bulunmadı; SSS görünür metinle uyumlu</Badge> : (
              <ul className="flex flex-col gap-1">{ldIssues.map((i, k) => <li key={k}><Badge tone={i.severity === "error" ? "danger" : "warning"}>{i.path}</Badge> {i.message}</li>)}</ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Kaynaklar ve sürümler" />
          <div className="flex flex-col gap-3 p-4 text-sm">
            <ul className="list-disc pl-5">{current.content.sources.length ? current.content.sources.map((s) => <li key={s.url}><a className="break-all text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.url}</a>{s.note ? ` — ${s.note}` : ""}</li>) : <li className="text-muted">Kaynak yok</li>}</ul>
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
  );
}

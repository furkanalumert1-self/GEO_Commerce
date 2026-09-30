import { Badge } from "@/components/ui";
import { ENGINE_SHORT, SURFACE_LABEL, fmtDate } from "@/lib/format";

export interface EvidenceObservation {
  id: string;
  provider: string;
  engine: string;
  model: string | null;
  surface: string;
  country: string;
  language: string;
  status: string;
  errorCode: string | null;
  sampledAt: Date;
  rawText: string | null;
  listDetected: boolean;
  repetition: number;
  attempt: number;
  promptVersion: { text: string; version: number };
  mentions: Array<{ entityId: string; entityType: string; kind: string; rank: number | null; confidence: number; excerpt: string | null; needsReview: boolean }>;
  citations: Array<{ id: string; url: string; domain: string; association: string; sourceType: string | null }>;
}

const KIND: Record<string, string> = { mention: "Mention", recommendation: "Öneri", negative: "Olumsuz", incidental: "Tesadüfi" };

/** Ham yanıt + citation provenance. Ham metin 30 gün sonra silinir (retention). */
export function ObservationEvidence({ o, names, timeZone }: { o: EvidenceObservation; names: Record<string, string>; timeZone: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-xs text-muted">Soru (v{o.promptVersion.version})</p>
        <p className="font-medium">{o.promptVersion.text}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-muted">Motor</dt><dd>{ENGINE_SHORT[o.engine] ?? o.engine} · {o.provider}</dd></div>
        <div><dt className="text-muted">Model</dt><dd>{o.model ?? "—"}</dd></div>
        <div><dt className="text-muted">Yüzey</dt><dd>{SURFACE_LABEL[o.surface] ?? o.surface}</dd></div>
        <div><dt className="text-muted">Ülke / dil</dt><dd>{o.country} / {o.language}</dd></div>
        <div><dt className="text-muted">Örnekleme</dt><dd>{fmtDate(o.sampledAt, timeZone, "tr-TR", true)}</dd></div>
        <div><dt className="text-muted">Tekrar / deneme</dt><dd>{o.repetition} / {o.attempt}</dd></div>
      </dl>
      {o.status !== "succeeded" ? <Badge tone="warning">Başarısız ({o.errorCode ?? o.status}) — görünürlük düşüşü sayılmaz</Badge> : null}
      <div>
        <p className="mb-1 text-xs text-muted">Ham yanıt {o.listDetected ? "(açık liste tespit edildi — sıra yalnız listede anlamlı)" : "(liste yok — sıra verilmez)"}</p>
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg p-3 font-sans text-sm whitespace-pre-wrap">{o.rawText ?? "Ham yanıt saklama süresi (30 gün) dolduğu için silindi."}</pre>
      </div>
      <div>
        <p className="mb-1 font-medium">Mention&apos;lar</p>
        {o.mentions.length === 0 ? <p className="text-muted">Takip edilen marka anılmadı.</p> : (
          <ul className="flex flex-col gap-2">
            {o.mentions.map((m) => (
              <li key={`${m.entityId}-${m.kind}`} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{names[m.entityId] ?? m.entityId}</span>
                  <Badge tone={m.kind === "recommendation" ? "success" : m.kind === "negative" ? "danger" : "neutral"}>{KIND[m.kind] ?? m.kind}</Badge>
                  {m.rank !== null ? <Badge>Liste sırası {m.rank}</Badge> : null}
                  {m.needsReview ? <Badge tone="warning">İnceleme gerekli</Badge> : null}
                  <span className="text-xs text-muted">güven {Math.round(m.confidence * 100)}%</span>
                </div>
                {m.excerpt ? <p className="mt-1 text-muted">&ldquo;{m.excerpt}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 font-medium">Citation&apos;lar</p>
        {o.citations.length === 0 ? <p className="text-muted">Kaynak gösterilmedi.</p> : (
          <ul className="flex flex-col gap-1">
            {o.citations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={c.association === "own" ? "success" : c.association === "competitor" ? "warning" : "neutral"}>{c.association === "own" ? "Kendi" : c.association === "competitor" ? "Rakip" : "Üçüncü taraf"}</Badge>
                <a className="break-all text-primary hover:underline" href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.url}</a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Bağlantı varlığı, sayfanın markayı önerdiğini tek başına kanıtlamaz.</p>
      </div>
    </div>
  );
}

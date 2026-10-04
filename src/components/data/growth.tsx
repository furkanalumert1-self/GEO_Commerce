import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, cn } from "@/components/ui";
import { ACTION_STATUS_LABEL } from "@/lib/format";
import { deltaText, IMPACT_LABEL, WORKFLOW_STEPS, type Delta, type ImpactLevel, type WorkflowView } from "@/lib/view-models";

/** Değer/birim, önceki döneme göre fark ve eksik veri ayrımı. Kart tümüyle ilgili sayfaya bağlanır. */
export function MetricCard({
  label,
  value,
  unit,
  delta,
  missing,
  scope,
  href,
  linkLabel,
  action,
  sentence,
  badge,
}: {
  label: string;
  /** Değerin günlük dildeki anlamı (yalnız gerçek veriden). */
  sentence?: ReactNode;
  badge?: ReactNode;
  value?: ReactNode;
  unit?: string;
  delta?: Delta;
  /** Değer yoksa: "Henüz ölçülmüyor" / "Entegrasyon gerekli" gibi; değer `—` gösterilir, 0 değil. */
  missing?: string;
  scope?: ReactNode;
  href: string;
  linkLabel: string;
  action?: ReactNode;
}) {
  return (
    <Card className="group relative flex min-h-[140px] flex-col p-4 hover:border-border-strong/60 sm:min-h-[160px] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="text-[13px] font-medium leading-snug text-text-secondary sm:text-sm">{label}</p>
        {badge}
      </div>
      <div className="tabular mt-2 text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] sm:mt-3 sm:text-[30px]">
        {missing ? <span className="text-lg text-text-secondary sm:text-xl">{missing}</span> : value}
        {!missing && unit ? <span className="ml-1 text-sm font-normal text-text-secondary sm:text-base">{unit}</span> : null}
      </div>
      {sentence ? <p className="mt-1.5 text-sm leading-snug text-text">{sentence}</p> : null}
      <div className="mt-1 text-xs leading-snug text-text-secondary sm:text-[13px]">
        {!missing && delta ? <DeltaLine delta={delta} /> : null}
        {scope ? (
          <>
            <p className="mt-0.5 hidden text-muted sm:block">{scope}</p>
            <details className="relative z-10 mt-0.5 sm:hidden">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted">Ayrıntı</summary>
              <p className="text-muted">{scope}</p>
            </details>
          </>
        ) : null}
      </div>
      <div className="mt-auto pt-2 text-sm sm:pt-3">
        {action ?? (
          <Link href={href} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary after:absolute after:inset-0 after:rounded-[var(--radius-lg)] hover:underline underline-offset-2 sm:min-h-0">
            {linkLabel}
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
    </Card>
  );
}

export function DeltaLine({ delta }: { delta: Delta }) {
  if (delta.kind === "none") return <span>{deltaText(delta)}</span>;
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1", delta.direction === "up" && "text-success", delta.direction === "down" && "text-danger")}>
      <Icon size={14} aria-hidden className="shrink-0" />
      <span>
        {deltaText(delta).replace(" önceki döneme göre", "")}
        <span className="hidden sm:inline"> önceki döneme göre</span>
        <span className="sr-only sm:hidden"> önceki döneme göre</span>
      </span>
    </span>
  );
}

export function ImpactBadge({ level }: { level: ImpactLevel }) {
  return (
    <Badge tone={level === "high" ? "primary" : level === "unknown" ? "neutral" : "neutral"}>
      {level === "unknown" ? IMPACT_LABEL.unknown : `Tahmini etki: ${IMPACT_LABEL[level]}`}
    </Badge>
  );
}

const ACTION_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  review: "warning",
  approved: "primary",
  publishing: "warning",
  published: "success",
  measuring: "primary",
  completed: "success",
  failed: "danger",
  rejected: "danger",
  rolled_back: "danger",
};

export function ActionStatusBadge({ status, manual, needsFix }: { status: string; manual?: boolean; needsFix?: boolean }) {
  if (needsFix && ["draft", "review", "approved"].includes(status)) return <Badge tone="danger">Düzeltme gerekli</Badge>;
  const label = status === "approved" ? "Onaylandı · yayına hazır" : manual && status === "measuring" ? "Sitenizde uygulandı · izleniyor" : (ACTION_STATUS_LABEL[status] ?? status);
  return <Badge tone={ACTION_TONE[status] ?? "neutral"}>{label}</Badge>;
}

/** Teşhis → Taslak → İnceleme → Uygulama → Ölçüm. Durum metinle de anlatılır (yalnız renk değil). */
export function WorkflowStepper({ view }: { view: WorkflowView }) {
  const icon = (st: string, i: number) => (st === "done" ? <Check size={14} aria-hidden className="shrink-0 text-primary" /> : st === "blocked" ? <X size={14} aria-hidden className="shrink-0 text-danger" /> : <span aria-hidden className="tabular shrink-0 text-muted">{i + 1}</span>);
  const srState = (st: string) => (st === "done" ? "tamamlandı" : st === "current" ? "geçerli adım" : st === "blocked" ? "engellendi" : "sırada");
  return (
    <nav aria-label="İş akışı adımları">
      {/* Mobil: tek satır "Adım X/5", adımlar açılabilir; etiketler kesilmez. */}
      <details className="sm:hidden">
        <summary className="no-marker flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold">
          <span>Adım {view.current + 1}/5 — {WORKFLOW_STEPS[view.current]}</span>
          <span className="text-xs font-medium text-primary">Adımlar ▾</span>
        </summary>
        <ol className="mt-2 flex flex-col gap-2">
          {WORKFLOW_STEPS.map((step, i) => (
            <li key={step} className={cn("flex items-center gap-2 text-sm", view.states[i] === "upcoming" ? "text-muted" : "text-text")}>{icon(view.states[i]!, i)}<span>{step}</span><span className="sr-only"> — {srState(view.states[i]!)}</span></li>
          ))}
        </ol>
      </details>
      <ol className="hidden grid-cols-5 gap-2 sm:grid">
        {WORKFLOW_STEPS.map((step, i) => {
          const st = view.states[i]!;
          return (
            <li key={step} aria-current={st === "current" || st === "blocked" ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
              <span aria-hidden className={cn("h-1 rounded-full", st === "done" && "bg-primary", st === "current" && "bg-primary", st === "blocked" && "bg-danger", st === "upcoming" && "bg-border")} />
              <span className={cn("flex min-w-0 items-start gap-1 text-[13px] leading-snug", st === "upcoming" ? "text-muted" : st === "current" ? "font-semibold text-text" : "font-medium text-text")}>
                {icon(st, i)}
                <span>{step}</span>
                <span className="sr-only"> — {srState(st)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PlatformBreakdown({ rows }: { rows: Array<{ key: string; label: string; score: number | null; samples: number; note?: string }> }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-text-secondary">Seçili dönemde platform verisi yok.</p>;
  return (
    <ul className="flex flex-col gap-4 px-5 py-5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="tabular font-semibold">{r.score ?? "—"}<span className="font-normal text-text-secondary"> / 100</span></span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-surface-subtle" aria-hidden>
            {r.score !== null && r.score > 0 ? <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, r.score)}%` }} /> : null}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {r.samples} geçerli yanıt{r.note ? ` · ${r.note}` : ""}
            {r.score === null ? " · ölçülemedi" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

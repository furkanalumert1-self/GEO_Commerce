import { Slot } from "@radix-ui/react-slot";
import clsx from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export const cn = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Standart 40 px; `size="sm"` kompakt 32 px (dokunmatikte yine ≥44 px). */
export function Button({ variant = "secondary", size = "md", asChild, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm"; asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-55",
        size === "md" ? "px-4 sm:min-h-10" : "px-3 sm:min-h-8",
        variant === "primary" && "border-primary bg-primary text-white shadow-[var(--shadow-card)] hover:border-primary-hover hover:bg-primary-hover",
        variant === "secondary" && "border-border bg-surface text-text shadow-[var(--shadow-card)] hover:border-border-strong hover:bg-surface-subtle",
        variant === "ghost" && "border-transparent bg-transparent text-text-secondary hover:bg-surface-subtle hover:text-text",
        variant === "danger" && "border-danger/40 bg-surface text-danger hover:bg-danger-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[17px] font-semibold leading-snug">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "border-border bg-surface-subtle text-text-secondary",
        tone === "primary" && "border-primary/25 bg-primary-soft text-primary",
        tone === "success" && "border-success/30 bg-success-soft text-success",
        tone === "warning" && "border-warning/30 bg-warning-soft text-warning",
        tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = "neutral", title, children, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; role?: "alert" | "status" }) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "rounded-[var(--radius-lg)] border px-4 py-3 text-sm",
        tone === "neutral" && "border-border bg-surface",
        tone === "primary" && "border-primary/30 bg-primary-soft",
        tone === "success" && "border-success/30 bg-success-soft",
        tone === "warning" && "border-warning/30 bg-warning-soft",
        tone === "danger" && "border-danger/30 bg-danger-soft",
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1", "text-text")}>{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, action, badges, breadcrumb }: { title: ReactNode; description?: ReactNode; action?: ReactNode; badges?: ReactNode; breadcrumb?: Array<{ label: string; href?: string }> }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb?.length ? <Breadcrumb items={breadcrumb} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em] sm:text-[30px]">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-2 max-w-3xl text-[15px] text-text-secondary">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-10">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-xl text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}

export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, numeric, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cn("border-b border-border bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-text-secondary", numeric ? "text-right" : "text-left", className)} {...props} />;
}

export function Td({ className, numeric, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn("h-[52px] border-b border-border px-4 align-middle", numeric && "tabular text-right", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function Stat({ label, value, unit, hint, badge, footnote }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; badge?: ReactNode; footnote?: ReactNode }) {
  return (
    <Card className="flex min-h-[132px] flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        {badge}
      </div>
      <p className="tabular mt-3 text-[30px] font-semibold leading-tight tracking-[-0.01em]">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {footnote ? <div className="mt-2 border-t border-border pt-2 text-xs text-muted">{footnote}</div> : null}
    </Card>
  );
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error ? <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${htmlFor}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export const inputClass = "min-h-11 w-full rounded-md border border-border-strong/60 bg-surface px-3 text-sm hover:border-border-strong sm:min-h-10 aria-[invalid=true]:border-danger";

/** Metriklerde kaynak/metodoloji görünürlüğü (§1). */
export function Provenance({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt>{k}:</dt>
          <dd className="text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Konum" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-text-secondary">
        {items.map((i, idx) => (
          <li key={`${i.label}-${idx}`} className="flex items-center gap-1">
            {idx > 0 ? <span aria-hidden className="text-muted">/</span> : null}
            {i.href ? (
              <Link href={i.href} className="rounded-sm hover:text-text hover:underline underline-offset-2">{i.label}</Link>
            ) : (
              <span aria-current="page" className="text-text">{i.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Bölüm başlığı (18–20 px) + isteğe bağlı sağ bağlantı. */
export function SectionHeader({ id, title, description, action }: { id?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold leading-snug sm:text-[19px]">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

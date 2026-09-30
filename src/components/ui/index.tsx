import { Slot } from "@radix-ui/react-slot";
import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export const cn = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", asChild, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9",
        variant === "primary" && "border-primary bg-primary text-white hover:bg-primary-hover",
        variant === "secondary" && "border-border bg-surface text-text hover:bg-bg",
        variant === "ghost" && "border-transparent bg-transparent text-text hover:bg-bg",
        variant === "danger" && "border-danger bg-surface text-danger hover:bg-danger-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
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
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "border-border bg-bg text-muted",
        tone === "primary" && "border-primary/30 bg-primary-soft text-primary",
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
        "rounded-md border px-4 py-3 text-sm",
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

export function PageHeader({ title, description, action, badges }: { title: ReactNode; description?: ReactNode; action?: ReactNode; badges?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-8">
      <p className="font-semibold">{title}</p>
      <p className="max-w-xl text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}

export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, numeric, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cn("border-b border-border bg-bg px-3 py-2 text-xs font-semibold text-muted", numeric ? "text-right" : "text-left", className)} {...props} />;
}

export function Td({ className, numeric, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn("h-12 border-b border-border px-3 align-middle", numeric && "tabular text-right", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function Stat({ label, value, unit, hint, badge, footnote }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; badge?: ReactNode; footnote?: ReactNode }) {
  return (
    <Card className="flex min-h-[132px] flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {badge}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {footnote ? <div className="mt-2 border-t border-border pt-2 text-xs text-muted">{footnote}</div> : null}
    </Card>
  );
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error ? <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${htmlFor}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export const inputClass = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm sm:min-h-9 aria-[invalid=true]:border-danger";

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

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn("card", padded && "p-4", className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-[650] leading-5 text-text">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardSection({ children, className, title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return (
    <div className={cn("border-t border-border px-4 py-3 first:border-t-0", className)}>
      {title && <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</h4>}
      {children}
    </div>
  );
}

/** Key/value rows used on detail pages. */
export function DescriptionList({ rows, className }: { rows: Array<{ label: ReactNode; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-6 gap-y-2 text-[13px]", className)}>
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-text-secondary">{r.label}</dt>
          <dd className="min-w-0 truncate text-text">{r.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

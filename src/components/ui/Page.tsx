import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional element rendered next to the title (e.g. a status badge). */
  titleMeta?: ReactNode;
  backHref?: string;
  backLabel?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Narrow content column for forms and settings. */
  narrow?: boolean;
  /** Full-bleed width for wide tables. */
  wide?: boolean;
}

export function Page({ title, subtitle, titleMeta, backHref, backLabel, primaryAction, secondaryActions, children, className, narrow, wide }: PageProps) {
  return (
    <div className={cn("animate-in mx-auto w-full px-5 py-5 md:px-8", narrow ? "max-w-3xl" : wide ? "max-w-[1400px]" : "max-w-[1160px]", className)}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {backHref && (
            <Link href={backHref} className="mb-1.5 inline-flex items-center gap-0.5 text-[12.5px] text-text-secondary hover:text-text">
              <ChevronLeft className="h-3.5 w-3.5" /> {backLabel ?? "Back"}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-text">{title}</h1>
            {titleMeta}
          </div>
          {subtitle && <p className="mt-0.5 text-[13px] text-text-secondary">{subtitle}</p>}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

/** Two-column layout for detail pages: main content + aside. */
export function PageLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {aside && <div className="flex flex-col gap-4">{aside}</div>}
    </div>
  );
}

export function Section({ title, description, children, actions }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[14px] font-semibold text-text">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] text-text-secondary">{description}</p>}
        {actions && <div className="mt-2">{actions}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

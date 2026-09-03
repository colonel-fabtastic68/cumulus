"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact card heading used both inside Card and inside Table toolbars. */
export function CardTitle({ icon, title, meta, action, className }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="shrink-0 text-text-tertiary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <h3 className="truncate text-[13.5px] font-semibold leading-5 text-text">{title}</h3>
        {meta}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Quiet "See all" style link used in card headers and footers. */
export function CardLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline", className)}>
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

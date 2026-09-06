"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import type { Member } from "@/lib/types";

// ---- Tabs ------------------------------------------------------------------

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto border-b border-border py-2", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-[12px] font-[550] transition-colors",
            t.value === value ? "bg-[rgba(0,0,0,0.06)] text-text" : "text-text-secondary hover:bg-[rgba(0,0,0,0.04)] hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("rounded-[6px] px-1.5 text-[11px]", t.value === value ? "bg-surface text-text-secondary" : "bg-fill-tertiary/70 text-text-secondary")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Empty state -----------------------------------------------------------

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-text-secondary [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <h3 className="text-[14px] font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- Banner ----------------------------------------------------------------

export type BannerTone = "info" | "success" | "warning" | "critical";

const bannerTones: Record<BannerTone, { cls: string; icon: ReactNode }> = {
  info: { cls: "bg-info-soft text-info border-info/20", icon: <Info className="h-4 w-4" /> },
  success: { cls: "bg-success-soft text-success border-success/20", icon: <CheckCircle2 className="h-4 w-4" /> },
  warning: { cls: "bg-warning-soft text-warning border-warning/20", icon: <AlertTriangle className="h-4 w-4" /> },
  critical: { cls: "bg-critical-soft text-critical border-critical/20", icon: <AlertCircle className="h-4 w-4" /> },
};

export function Banner({ tone = "info", title, children, action, onDismiss, className }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; onDismiss?: () => void; className?: string }) {
  const t = bannerTones[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px]", t.cls, className)}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-text-secondary [&_a]:underline")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ---- Toasts ----------------------------------------------------------------

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: "default" | "success" | "critical";
}

const ToastContext = createContext<{ toast: (message: ReactNode, tone?: ToastItem["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const toast = useCallback((message: ReactNode, tone: ToastItem["tone"] = "default") => {
    const id = ++counter.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-in pointer-events-auto flex items-center gap-2 rounded-[var(--radius)] px-3.5 py-2 text-[13px] shadow-[var(--shadow-pop)]",
              t.tone === "critical" ? "bg-critical text-white" : "bg-primary text-white",
            )}
          >
            {t.tone === "success" && <CheckCircle2 className="h-4 w-4" />}
            {t.tone === "critical" && <AlertCircle className="h-4 w-4" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

// ---- Avatar ----------------------------------------------------------------

export function Avatar({ member, size = 28, className, online }: { member: Pick<Member, "name"> & { color?: string }; size?: number; className?: string; online?: boolean }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} title={member.name}>
      <span
        style={{ width: size, height: size, background: member.color ?? "var(--text-tertiary)", fontSize: Math.max(10, size * 0.4) }}
        className="inline-flex items-center justify-center rounded-full font-semibold text-white"
      >
        {initials(member.name)}
      </span>
      {online !== undefined && (
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface", online ? "bg-success" : "bg-border-strong")} />
      )}
    </span>
  );
}

export function AvatarStack({ members, max = 4 }: { members: Array<Pick<Member, "name"> & { color?: string }>; max?: number }) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((m, i) => (
        <Avatar key={i} member={m} size={24} className={cn("ring-2 ring-surface", i > 0 && "-ml-1.5")} />
      ))}
      {rest > 0 && <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-hover text-[10px] font-medium text-text-secondary ring-2 ring-surface">+{rest}</span>}
    </span>
  );
}

// ---- Stat tile -------------------------------------------------------------

export function Stat({ label, value, hint, tone, icon, href, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "default" | "success" | "warning" | "critical"; icon?: ReactNode; href?: string; className?: string }) {
  const toneCls = { default: "text-text", success: "text-success", warning: "text-warning", critical: "text-critical" }[tone ?? "default"];
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-text-secondary">{label}</span>
        {icon && <span className="text-text-tertiary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      </div>
      <div className={cn("mt-1.5 text-[22px] font-semibold leading-7 tracking-[-0.01em] tabular", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-text-tertiary">{hint}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cn("card block p-4 transition-colors hover:bg-surface-subdued", className)}>
        {inner}
      </Link>
    );
  }
  return <div className={cn("card p-4", className)}>{inner}</div>;
}

// ---- Skeleton --------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[var(--radius-sm)] bg-surface-hover", className)} />;
}

// ---- Dropdown menu ---------------------------------------------------------

export interface MenuItem {
  label: ReactNode;
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export function Menu({ trigger, items, align = "right", className }: { trigger: ReactNode; items: Array<MenuItem | "divider">; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the menu only; stop it before any surrounding dialog sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div role="menu" className={cn("animate-in absolute z-[60] mt-1 min-w-[180px] rounded-[var(--radius)] bg-surface p-1 shadow-[var(--shadow-pop)]", align === "right" ? "right-0" : "left-0")}>
          {items.map((it, i) =>
            it === "divider" ? (
              <div key={i} className="my-1 border-t border-border" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  if (it.href) router.push(it.href);
                  else it.onSelect?.();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-hover disabled:opacity-50",
                  it.destructive ? "text-critical" : "text-text",
                )}
              >
                {it.icon && <span className="text-text-secondary [&>svg]:h-3.5 [&>svg]:w-3.5">{it.icon}</span>}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---- Keyboard hint ---------------------------------------------------------

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong/60 bg-surface-subdued px-1 font-mono text-[11px] text-text-secondary">{children}</kbd>;
}

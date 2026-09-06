"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./Button";

/** Open dialogs, innermost last. Only the topmost one reacts to Escape. */
const dialogStack: string[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behaviour: register on the stack, close on Escape when
 * topmost, move focus inside on open, trap Tab, and restore focus on close.
 */
function useDialog(open: boolean, onClose: () => void, containerRef: React.RefObject<HTMLDivElement | null>, lockScroll: boolean) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    dialogStack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = () => Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement);
    // Focus the first field, else the first button, else the container itself.
    const initial = focusables().find((el) => el.matches("input, select, textarea")) ?? focusables()[0];
    (initial ?? container)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && container) {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0]!;
        const last = els[els.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      const idx = dialogStack.lastIndexOf(id);
      if (idx >= 0) dialogStack.splice(idx, 1);
      if (lockScroll) document.body.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, id, containerRef, lockScroll]);
  return id;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

export function Modal({ open, onClose, title, subtitle, children, footer, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useDialog(open, onClose, ref, true);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? `${id}-title` : undefined} className={cn("animate-in w-full rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-pop)] outline-none", sizes[size])}>
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
            <div>
              {title && <h2 id={`${id}-title`} className="text-[16px] font-[650] leading-6 text-text">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-[12.5px] text-text-secondary">{subtitle}</p>}
            </div>
            <IconButton variant="plain" size="sm" onClick={onClose} aria-label="Close" className="text-text-secondary">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Right-hand slide-over panel. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 480, headerActions }: { open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; headerActions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useDialog(open, onClose, ref, false);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? `${id}-title` : undefined} style={{ width: `min(${width}px, 100vw)` }} className="slide-in-right absolute inset-y-0 right-0 flex flex-col bg-surface shadow-[var(--shadow-pop)] outline-none">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 id={`${id}-title`} className="truncate text-[16px] font-[650] leading-6 text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12.5px] text-text-secondary">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <IconButton variant="plain" size="sm" onClick={onClose} aria-label="Close" className="text-text-secondary">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", destructive, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; message?: ReactNode; confirmLabel?: string; destructive?: boolean; loading?: boolean }) {
  // Lazy import to avoid circular type noise
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Button } = require("./Button") as typeof import("./Button");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "critical" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-text-secondary">{message}</div>
    </Modal>
  );
}

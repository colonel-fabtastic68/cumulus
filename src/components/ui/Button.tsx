"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "plain" | "critical" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  href?: string;
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none transition-colors disabled:opacity-50 disabled:pointer-events-none rounded-[var(--radius-sm)]";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-text-inverse hover:bg-primary-hover shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]",
  secondary: "bg-surface text-text border border-border-strong/70 hover:bg-surface-hover shadow-[0_1px_0_rgba(0,0,0,0.04)]",
  plain: "bg-transparent text-accent hover:bg-accent-soft/70",
  critical: "bg-critical text-text-inverse hover:bg-critical-hover",
  success: "bg-success text-text-inverse hover:bg-success-hover",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-8 px-3 text-[13px]",
  lg: "h-9 px-4 text-[13.5px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, iconRight, className, children, href, fullWidth, disabled, type = "button", ...rest },
  ref,
) {
  const cls = cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
  const content = (
    <>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span> : null}
      {children}
      {iconRight ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{iconRight}</span> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-disabled={disabled}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  );
});

/** Icon-only button with a tooltip-ish title. */
export function IconButton({ className, size = "md", ...rest }: ButtonProps) {
  return <Button {...rest} size={size} className={cn("px-0", size === "sm" ? "w-7" : size === "lg" ? "w-9" : "w-8", className)} />;
}

"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Polaris button vocabulary: `variant` sets emphasis (primary / secondary /
 * tertiary / plain), `tone` sets intent (critical / success). The legacy
 * "critical" and "success" variants map to a primary button with that tone.
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "plain" | "critical" | "success";
export type ButtonTone = "auto" | "critical" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  href?: string;
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none rounded-[var(--radius-sm)] font-[550] transition-[background-color,box-shadow,color] duration-100 disabled:pointer-events-none";

/** variant → tone → classes */
const styles: Record<Exclude<ButtonVariant, "critical" | "success">, Record<ButtonTone, string>> = {
  primary: {
    auto: "bg-primary text-text-inverse shadow-[var(--shadow-button-primary)] hover:bg-primary-hover hover:shadow-[var(--shadow-button-primary-hover)] active:bg-primary-active disabled:bg-fill-tertiary disabled:text-text-disabled disabled:shadow-none",
    critical: "bg-critical-fill text-text-inverse shadow-[var(--shadow-button-primary)] hover:bg-critical-hover active:bg-critical disabled:bg-fill-tertiary disabled:text-text-disabled disabled:shadow-none",
    success: "bg-success-fill text-text-inverse shadow-[var(--shadow-button-primary)] hover:bg-success-hover active:bg-success disabled:bg-fill-tertiary disabled:text-text-disabled disabled:shadow-none",
  },
  secondary: {
    auto: "bg-surface text-text shadow-[var(--shadow-button)] hover:bg-surface-hover hover:shadow-[var(--shadow-button-hover)] active:bg-surface-active disabled:bg-surface-subdued disabled:text-text-disabled disabled:shadow-[inset_0_0_0_1px_var(--border)]",
    critical: "bg-surface text-critical shadow-[var(--shadow-button)] hover:bg-critical-soft hover:shadow-[var(--shadow-button-hover)] disabled:bg-surface-subdued disabled:text-text-disabled",
    success: "bg-surface text-success shadow-[var(--shadow-button)] hover:bg-success-soft hover:shadow-[var(--shadow-button-hover)] disabled:bg-surface-subdued disabled:text-text-disabled",
  },
  tertiary: {
    auto: "bg-transparent text-text hover:bg-[rgba(0,0,0,0.05)] active:bg-[rgba(0,0,0,0.08)] disabled:text-text-disabled",
    critical: "bg-transparent text-critical hover:bg-critical-soft disabled:text-text-disabled",
    success: "bg-transparent text-success hover:bg-success-soft disabled:text-text-disabled",
  },
  plain: {
    auto: "bg-transparent text-accent hover:bg-[rgba(0,91,211,0.08)] hover:text-accent-hover active:bg-[rgba(0,91,211,0.14)] disabled:text-text-disabled",
    critical: "bg-transparent text-critical hover:bg-critical-soft disabled:text-text-disabled",
    success: "bg-transparent text-success hover:bg-success-soft disabled:text-text-disabled",
  },
};

/** Polaris sizes: 24 / 28 / 32px with 12px labels (13px on large). */
const sizes: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-[12px] leading-4",
  md: "h-7 px-3 text-[12px] leading-4",
  lg: "h-8 px-3 text-[13px] leading-5",
};

function resolve(variant: ButtonVariant, tone: ButtonTone): string {
  if (variant === "critical") return styles.primary.critical;
  if (variant === "success") return styles.primary.success;
  return styles[variant][tone];
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", tone = "auto", size = "md", loading, icon, iconRight, className, children, href, fullWidth, disabled, type = "button", ...rest },
  ref,
) {
  const cls = cn(base, resolve(variant, tone), sizes[size], fullWidth && "w-full", className);
  const iconSize = size === "lg" ? "[&>svg]:h-4 [&>svg]:w-4" : "[&>svg]:h-3.5 [&>svg]:w-3.5";
  const content = (
    <>
      {loading ? <Loader2 className={cn("animate-spin", size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5")} /> : icon ? <span className={cn("shrink-0", iconSize)}>{icon}</span> : null}
      {children}
      {iconRight ? <span className={cn("shrink-0", iconSize)}>{iconRight}</span> : null}
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

/** Icon-only button; pass aria-label. */
export function IconButton({ className, size = "md", variant = "secondary", ...rest }: ButtonProps) {
  return <Button {...rest} variant={variant === "plain" ? "tertiary" : variant} size={size} className={cn("px-0", size === "sm" ? "w-6" : size === "lg" ? "w-8" : "w-7", className)} />;
}

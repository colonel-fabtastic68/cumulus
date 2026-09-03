"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2.5 text-[13px] text-text placeholder:text-text-tertiary shadow-[0_1px_0_rgba(0,0,0,0.03)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-subdued disabled:text-text-tertiary";

export function Label({ children, htmlFor, hint, className }: { children: ReactNode; htmlFor?: string; hint?: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1 block text-[12.5px] font-medium text-text", className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-text-tertiary">{hint}</span>}
    </label>
  );
}

export function HelpText({ children, error }: { children?: ReactNode; error?: boolean }) {
  if (!children) return null;
  return <p className={cn("mt-1 text-[12px]", error ? "text-critical" : "text-text-tertiary")}>{children}</p>;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label?: ReactNode;
  hint?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, help, error, prefix, suffix, className, containerClassName, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={containerClassName}>
      {label && (
        <Label htmlFor={fid} hint={hint}>
          {label}
        </Label>
      )}
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px] text-text-tertiary">{prefix}</span>}
        <input ref={ref} id={fid} className={cn(fieldBase, "h-8", prefix && "pl-7", suffix && "pr-8", error && "border-critical focus:border-critical focus:ring-critical/20", className)} {...rest} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12.5px] text-text-tertiary">{suffix}</span>}
      </div>
      <HelpText error={!!error}>{error ?? help}</HelpText>
    </div>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, hint, help, error, className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div>
      {label && (
        <Label htmlFor={fid} hint={hint}>
          {label}
        </Label>
      )}
      <textarea ref={ref} id={fid} className={cn(fieldBase, "min-h-[72px] py-1.5", error && "border-critical", className)} {...rest} />
      <HelpText error={!!error}>{error ?? help}</HelpText>
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, help, error, options, placeholder, className, containerClassName, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={containerClassName}>
      {label && (
        <Label htmlFor={fid} hint={hint}>
          {label}
        </Label>
      )}
      <div className="relative">
        <select ref={ref} id={fid} className={cn(fieldBase, "h-8 appearance-none pr-8", error && "border-critical", className)} {...rest}>
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      </div>
      <HelpText error={!!error}>{error ?? help}</HelpText>
    </div>
  );
});

export function Checkbox({ label, checked, onChange, indeterminate, disabled, className, help, "aria-label": ariaLabel }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; indeterminate?: boolean; disabled?: boolean; className?: string; help?: ReactNode; "aria-label"?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-start gap-2 text-[13px]", disabled && "cursor-not-allowed opacity-60", className)}>
      <span
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!disabled) onChange(!checked);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }}
        className={cn(
          "mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          checked || indeterminate ? "border-primary bg-primary text-text-inverse" : "border-border-strong bg-surface",
        )}
      >
        {indeterminate ? <span className="h-[2px] w-2 bg-current" /> : checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      {label && (
        <span>
          <span className="text-text">{label}</span>
          {help && <span className="block text-[12px] text-text-tertiary">{help}</span>}
        </span>
      )}
    </label>
  );
}

export interface ToggleProps {
  label?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: ReactNode;
  disabled?: boolean;
  /** Compact 20px track for dense rows. */
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/**
 * iOS-style switch: green track when on, light gray when off, white knob.
 * The knob is anchored with left-0 so it always travels inside the track.
 */
export function Toggle({ label, checked, onChange, help, disabled, size = "md", className, "aria-label": ariaLabel }: ToggleProps) {
  const track = size === "sm" ? "h-5 w-[34px]" : "h-[26px] w-[46px]";
  const knob = size === "sm" ? "h-4 w-4" : "h-[22px] w-[22px]";
  const travel = size === "sm" ? "translate-x-[14px]" : "translate-x-5";
  const id = useId();
  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel ?? (label && typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent p-0 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-switch-on/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
        track,
        checked ? "bg-switch-on" : "bg-switch-off",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-0 rounded-full bg-switch-knob shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-in-out",
          knob,
          checked ? travel : "translate-x-0",
        )}
      />
    </button>
  );
  if (!label && !help) return <span className={cn("inline-flex", disabled && "opacity-60", className)}>{control}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60", className)}>
      <label htmlFor={id} className={cn("min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="text-[13px] font-medium text-text">{label}</span>
        {help && <span className="block text-[12px] text-text-tertiary">{help}</span>}
      </label>
      <span className="mt-px shrink-0">{control}</span>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Search", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      <input
        type="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, "h-8 pl-8 pr-7 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:bg-surface-hover hover:text-text" aria-label="Clear">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Simple responsive form grid. */
export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[cols];
  return <div className={cn("grid gap-3", c, className)}>{children}</div>;
}

/** Segmented filter control, e.g. status tabs above a table. */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-surface-hover p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors",
            o.value === value ? "bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-secondary hover:text-text",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px]", o.value === value ? "bg-surface-hover text-text-secondary" : "text-text-tertiary")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

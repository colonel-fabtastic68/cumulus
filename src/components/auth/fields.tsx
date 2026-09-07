"use client";

import { useState } from "react";
import { TextField, type TextFieldProps } from "@/components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL_RE.test(v)) return "That email address doesn't look right.";
  return undefined;
}

export function passwordError(value: string): string | undefined {
  if (!value) return "Enter a password.";
  if (value.length < 6) return "Use at least 6 characters.";
  return undefined;
}

/** Password field with a Show / Hide toggle. */
export function PasswordField({ label = "Password", ...rest }: Omit<TextFieldProps, "type" | "suffix">) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...rest}
      label={label}
      type={visible ? "text" : "password"}
      suffix={
        <button type="button" onClick={() => setVisible((v) => !v)} className="text-[12px] font-medium text-text-secondary hover:text-text" aria-pressed={visible}>
          {visible ? "Hide" : "Show"}
        </button>
      }
    />
  );
}

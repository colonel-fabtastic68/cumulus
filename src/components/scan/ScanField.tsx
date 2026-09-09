"use client";

import { useState, type KeyboardEvent } from "react";
import { ScanBarcode } from "lucide-react";
import { TextField, type TextFieldProps } from "@/components/ui";
import { normalizeCode } from "@/lib/scan";

/**
 * A text field that accepts a barcode scanner (or typed code) and fires
 * onScan on Enter, then clears itself. Use inside receiving, transfers and picks.
 */
export function ScanField({ onScan, label = "Scan or type a code", placeholder = "Barcode, SKU or part number", ...rest }: Omit<TextFieldProps, "value" | "onChange" | "onKeyDown"> & { onScan: (code: string) => void }) {
  const [value, setValue] = useState("");
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = normalizeCode(value);
    if (!code) return;
    onScan(code);
    setValue("");
  };
  return <TextField {...rest} label={label} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} prefix={<ScanBarcode className="h-4 w-4 text-icon" />} autoComplete="off" />;
}

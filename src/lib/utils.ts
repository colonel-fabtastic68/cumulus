/** Tiny className joiner (no dependency on clsx). */
export function cn(...parts: Array<string | number | bigint | boolean | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** URL-safe random id. Uses crypto when available. */
export function newId(prefix?: string): string {
  let out = "";
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysAgoIso(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() - days * 86_400_000);
  return d.toISOString();
}

export function daysBetween(aIso: string, bIso: string = nowIso()): number {
  return Math.max(0, Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export function groupBy<T, K extends string | number>(rows: T[], key: (row: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const row of rows) {
    const k = key(row);
    (out[k] ||= []).push(row);
  }
  return out;
}

export function uniq<T>(rows: T[]): T[] {
  return Array.from(new Set(rows));
}

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

/** Simple case-insensitive substring match across several fields. */
export function matches(query: string, ...fields: Array<string | undefined | null>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

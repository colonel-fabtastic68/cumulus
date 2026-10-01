/** Formatting helpers. Keep display logic in one place. */

export function formatMoney(amount: number, currency = "USD", opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: opts.compact ? 0 : 2,
      notation: opts.compact ? "compact" : "standard",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(n);
}

export function formatQty(n: number, unit?: string): string {
  const s = formatNumber(n, Number.isInteger(n) ? 0 : 2);
  return unit && unit !== "ea" ? `${s} ${unit}` : s;
}

export function formatPercent(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

/**
 * A plain date (YYYY-MM-DD: expected dates, order-by dates, snoozes) is a
 * calendar day in the workspace's local sense, so it is read as local
 * midnight; `new Date("2026-10-03")` would read it as UTC and show the day
 * before anywhere west of Greenwich. Timestamps parse as usual.
 */
export function parseDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseDate(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseDate(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3d ago" for the past, "in 3d" for the future (expected dates, snoozes). */
export function formatRelative(iso?: string | null): string {
  if (!iso) return "—";
  const t = parseDate(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const future = diff < 0;
  const s = Math.round(Math.abs(diff) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  const unit = m < 60 ? `${m}m` : Math.round(m / 60) < 24 ? `${Math.round(m / 60)}h` : Math.round(m / 1440) < 30 ? `${Math.round(m / 1440)}d` : Math.round(m / 43_200) < 12 ? `${Math.round(m / 43_200)}mo` : `${Math.round(m / 525_600)}y`;
  return future ? `in ${unit}` : `${unit} ago`;
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Convert a yyyy-mm-dd input value into an ISO string at local noon. */
export function fromDateInput(value: string): string {
  if (!value) return new Date().toISOString();
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0).toISOString();
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

import type { CalendarEvent } from "@/lib/types";

/** Month-view arithmetic on YYYY-MM-DD keys, so nothing shifts with the viewer's time zone. */

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, days: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export interface MonthCell {
  key: string;
  day: number;
  inMonth: boolean;
  today: boolean;
}

/** Six rows of seven days, weeks starting on Sunday, padded with the neighbouring months. */
export function monthGrid(year: number, month: number, today = dateKey(new Date())): MonthCell[][] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const rows: MonthCell[][] = [];
  const cursor = new Date(start);
  for (let r = 0; r < 6; r++) {
    const row: MonthCell[] = [];
    for (let c = 0; c < 7; c++) {
      const key = dateKey(cursor);
      row.push({ key, day: cursor.getDate(), inMonth: cursor.getMonth() === month, today: key === today });
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
  }
  return rows;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** True when the event covers this day (single-day events cover just their date). */
export function eventCovers(e: CalendarEvent, key: string): boolean {
  const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
  return key >= e.date && key <= end;
}

export function eventsOn(events: CalendarEvent[], key: string): CalendarEvent[] {
  return events.filter((e) => eventCovers(e, key)).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}

export const EVENT_COLORS = ["#1f5f8b", "#0f7b5f", "#b45309", "#8e1f0b", "#6d28d9", "#475569"];

/** Short, unguessable, URL-safe share slug (about 50 bits). */
export function newSlug(random: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export function formatEventWhen(e: Pick<CalendarEvent, "date" | "endDate" | "time">): string {
  const fmt = (k: string) => parseKey(k).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const range = e.endDate && e.endDate !== e.date ? `${fmt(e.date)} – ${fmt(e.endDate)}` : fmt(e.date);
  return e.time ? `${range} · ${formatTime(e.time)}` : range;
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const d = new Date(2000, 0, 1, h, m ?? 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** An iCalendar file for one event, so it can be added to any calendar app. */
export function eventIcs(e: CalendarEvent, opts: { url?: string; organizer?: string } = {}): string {
  const stamp = (k: string, t?: string) => (t ? `${k.replace(/-/g, "")}T${t.replace(":", "")}00` : k.replace(/-/g, ""));
  const endKey = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//cumulusOS//Team calendar//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@cumulusos.com`,
    `DTSTAMP:${new Date(e.updatedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    e.time ? `DTSTART:${stamp(e.date, e.time)}` : `DTSTART;VALUE=DATE:${stamp(e.date)}`,
    e.time ? `DTEND:${stamp(e.date, e.time)}` : `DTEND;VALUE=DATE:${stamp(addDays(endKey, 1))}`,
    `SUMMARY:${escapeIcs(e.title)}`,
    ...(e.notes ? [`DESCRIPTION:${escapeIcs([e.notes, ...(e.links ?? []).map((l) => `${l.label}: ${l.url}`), opts.url].filter(Boolean).join("\n"))}`] : opts.url ? [`DESCRIPTION:${escapeIcs(opts.url)}`] : []),
    ...(opts.url ? [`URL:${opts.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
}

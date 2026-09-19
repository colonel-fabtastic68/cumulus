"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Link2, Plus, Share2, Trash2 } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { Badge, Banner, Button, ConfirmDialog, Modal, TextArea, TextField, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { EVENT_COLORS, dateKey, eventsOn, formatEventWhen, formatTime, monthGrid, monthLabel } from "@/lib/calendar";
import { useSession } from "@/lib/session";
import { useCollection, useStore } from "@/lib/store/provider";
import { cn, newId, nowIso } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Shared month view: anyone with write access adds events; each event can carry links and a public share link. */
export function TeamCalendar() {
  const events = useCollection("events");
  const user = useCurrentUser();
  const writable = canWrite(user);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [editing, setEditing] = useState<{ event?: CalendarEvent; date?: string } | null>(null);
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const todayKey = dateKey(today);

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" icon={<ChevronLeft />} aria-label="Previous month" onClick={() => shift(-1)} />
          <Button size="sm" icon={<ChevronRight />} aria-label="Next month" onClick={() => shift(1)} />
        </div>
        <h2 className="text-[16px] font-semibold text-text">{monthLabel(year, month)}</h2>
        <Button size="sm" variant="plain" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>
          Today
        </Button>
        <div className="flex-1" />
        {writable && (
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing({ date: todayKey })}>
            New event
          </Button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-surface-subdued text-[11.5px] font-semibold uppercase tracking-wide text-text-tertiary">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        {grid.map((row, r) => (
          <div key={r} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {row.map((cell) => {
              const dayEvents = eventsOn(events, cell.key);
              return (
                <div
                  key={cell.key}
                  role={writable ? "button" : undefined}
                  tabIndex={writable ? 0 : undefined}
                  onClick={() => writable && setEditing({ date: cell.key })}
                  onKeyDown={(e) => {
                    if (writable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setEditing({ date: cell.key });
                    }
                  }}
                  className={cn("min-h-[96px] border-r border-border p-1.5 last:border-r-0", cell.inMonth ? "bg-surface" : "bg-surface-subdued/60", writable && "cursor-pointer hover:bg-surface-hover")}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px]", cell.today ? "bg-primary font-semibold text-text-inverse" : cell.inMonth ? "text-text" : "text-text-tertiary")}>{cell.day}</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setEditing({ event: e });
                        }}
                        className="flex w-full items-center gap-1.5 truncate rounded-[4px] px-1.5 py-0.5 text-left text-[11.5px] leading-4 text-text hover:bg-surface-hover"
                        style={{ boxShadow: `inset 3px 0 0 ${e.color ?? EVENT_COLORS[0]}` }}
                        title={`${e.title}${e.time ? ` · ${formatTime(e.time)}` : ""}`}
                      >
                        {e.time && <span className="shrink-0 text-text-tertiary">{formatTime(e.time)}</span>}
                        <span className="truncate">{e.title}</span>
                      </button>
                    ))}
                    {dayEvents.length > 3 && <span className="px-1.5 text-[11px] text-text-tertiary">+{dayEvents.length - 3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <EventModal key={editing?.event?.id ?? editing?.date ?? "closed"} state={editing} onClose={() => setEditing(null)} writable={writable} />
    </div>
  );
}

function EventModal({ state, onClose, writable }: { state: { event?: CalendarEvent; date?: string } | null; onClose: () => void; writable: boolean }) {
  const store = useStore();
  const session = useSession();
  const api = useApi();
  const toast = useToast();
  const user = useCurrentUser();
  const e = state?.event;
  const [title, setTitle] = useState(e?.title ?? "");
  const [date, setDate] = useState(e?.date ?? state?.date ?? dateKey(new Date()));
  const [endDate, setEndDate] = useState(e?.endDate ?? "");
  const [time, setTime] = useState(e?.time ?? "");
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>(e?.links?.length ? e.links : []);
  const [color, setColor] = useState(e?.color ?? EVENT_COLORS[0]!);
  const [busy, setBusy] = useState<"save" | "delete" | "share" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(e?.slug ?? "");
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const shareUrl = slug && typeof window !== "undefined" ? `${window.location.origin}/e/${slug}` : "";

  const save = async () => {
    if (!title.trim()) return setError("Give the event a title.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Pick a date.");
    if (endDate && endDate < date) return setError("The end date is before the start.");
    setBusy("save");
    setError(null);
    const cleanLinks = links.map((l) => ({ label: l.label.trim() || l.url.trim(), url: normalizeUrl(l.url) })).filter((l) => l.url);
    const now = nowIso();
    try {
      if (e) {
        await store.patch("events", e.id, { title: title.trim(), date, endDate: endDate || undefined, time: time || undefined, notes: notes.trim() || undefined, links: cleanLinks.length ? cleanLinks : undefined, color, updatedAt: now });
        toast("Event updated", "success");
      } else {
        const ev: CalendarEvent = { id: newId("evt"), title: title.trim(), date, endDate: endDate || undefined, time: time || undefined, notes: notes.trim() || undefined, links: cleanLinks.length ? cleanLinks : undefined, color, createdBy: user.id, createdByName: user.name, createdAt: now, updatedAt: now };
        await store.put("events", ev);
        toast("Event added", "success");
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!e) return;
    setBusy("delete");
    try {
      await store.remove("events", e.id);
      toast("Event deleted", "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const share = async () => {
    if (!e) return;
    setBusy("share");
    setError(null);
    try {
      const res = await api<{ slug: string }>("/api/events/share", { eventId: e.id });
      setSlug(res.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    if (await copyText(shareUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="md"
        title={e ? e.title : "New event"}
        subtitle={e ? `${formatEventWhen(e)}${e.createdByName ? ` · added by ${e.createdByName}` : ""}` : "Everyone in the workspace sees it on the team calendar."}
        footer={
          <>
            {e && writable && (
              <Button variant="plain" icon={<Trash2 />} className="mr-auto text-critical" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>{writable ? "Cancel" : "Close"}</Button>
            {writable && (
              <Button variant="primary" onClick={() => void save()} loading={busy === "save"} disabled={busy !== null}>
                {e ? "Save changes" : "Add event"}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField label="Title" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Inventory count · Trade show · Supplier visit" autoFocus disabled={!writable} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField label="Date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} disabled={!writable} />
            <TextField label="Ends" hint="(optional)" type="date" value={endDate} onChange={(ev) => setEndDate(ev.target.value)} disabled={!writable} />
            <TextField label="Time" hint="(optional)" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} disabled={!writable} />
          </div>
          <TextArea label="Notes" hint="(optional)" value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} placeholder="What, where, who's going." disabled={!writable} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-text">Links</span>
              {writable && (
                <Button size="sm" variant="plain" icon={<Link2 />} onClick={() => setLinks((l) => [...l, { label: "", url: "" }])}>
                  Add link
                </Button>
              )}
            </div>
            {links.length === 0 && <p className="text-[12.5px] text-text-tertiary">Agendas, documents, meeting rooms, tickets.</p>}
            {links.map((l, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <TextField label={i === 0 ? "Label" : undefined} value={l.label} onChange={(ev) => setLinks((cur) => cur.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} placeholder="Agenda" containerClassName="sm:w-40" disabled={!writable} />
                <TextField label={i === 0 ? "URL" : undefined} value={l.url} onChange={(ev) => setLinks((cur) => cur.map((x, j) => (j === i ? { ...x, url: ev.target.value } : x)))} placeholder="https://" containerClassName="flex-1" disabled={!writable} />
                {writable && <Button size="md" variant="plain" icon={<Trash2 />} aria-label="Remove link" onClick={() => setLinks((cur) => cur.filter((_, j) => j !== i))} />}
                {!writable && l.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:underline">
                    Open
                  </a>
                )}
              </div>
            ))}
          </div>

          {writable && (
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-text">Color</span>
              {EVENT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn("h-6 w-6 rounded-full border-2", color === c ? "border-text" : "border-transparent")} style={{ background: c }} />
              ))}
            </div>
          )}

          {e && (
            <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px] font-medium text-text">
                  <Share2 className="h-4 w-4 text-text-secondary" /> Share link
                  {slug && <Badge tone="success">Public</Badge>}
                </div>
                {session.mode !== "firestore" ? (
                  <span className="text-[12px] text-text-tertiary">Needs the hosted version</span>
                ) : slug ? (
                  <Button size="sm" onClick={() => void copy()}>
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                ) : writable ? (
                  <Button size="sm" onClick={() => void share()} loading={busy === "share"} disabled={busy !== null}>
                    Create share link
                  </Button>
                ) : null}
              </div>
              {slug ? (
                <p className="mt-1.5 break-all font-mono text-[12px] text-text-secondary">{shareUrl}</p>
              ) : (
                <p className="mt-1 text-[12px] text-text-secondary">Anyone with the link sees the title, date, notes and links, and can add it to their own calendar. No sign-in needed.</p>
              )}
            </div>
          )}
          {e?.time && (
            <p className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
              <Clock className="h-3.5 w-3.5" /> Times are shown as entered, without time-zone conversion.
            </p>
          )}
          {error && <Banner tone="critical">{error}</Banner>}
        </div>
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()} destructive title={`Delete “${e?.title}”?`} confirmLabel="Delete" loading={busy === "delete"} message={<>It disappears for everyone, and any share link stops working.</>} />
    </>
  );
}

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}

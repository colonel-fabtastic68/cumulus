"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Printer, Sparkles, XCircle } from "lucide-react";
import type { CycleCount, CycleCountLine } from "@/lib/types";
import { cancelCycleCount, completeCycleCount, countProgress, describeScope, lineVariance, recordCounts } from "@/lib/cycleCounts";
import { useLocations } from "@/lib/locations";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDateTime, formatMoney, formatRelative, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Page, Stat, TextField, useToast } from "@/components/ui";
import { CountStatusBadge, printCountSheet } from "@/components/counts";

export default function CycleCountPage() {
  const { id } = useParams<{ id: string }>();
  const counts = useCollection("cycleCounts");
  const count = useMemo(() => counts.find((c) => c.id === id) ?? null, [counts, id]);
  if (!count) {
    return (
      <Page title="Count not found" backHref="/inventory/counts" backLabel="Cycle counts">
        <Card padded={false}>
          <EmptyState title="We couldn't find that count" description="It may have been deleted, or the link is out of date." action={<Button href="/inventory/counts">Back to cycle counts</Button>} />
        </Card>
      </Page>
    );
  }
  return <CountSheet count={count} />;
}

function CountSheet({ count }: { count: CycleCount }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const router = useRouter();
  const itemsById = useItemsById();
  const locations = useLocations();
  const settings = useSettings();
  const members = useCollection("members");
  const { open: openAgent, setPageContext } = useAgent();
  const writable = canWrite(user) && count.status === "open";
  const location = locations.find((l) => l.id === count.locationId);
  const [reveal, setReveal] = useState(!count.blind);
  const [drafts, setDrafts] = useState<Record<string, { counted?: string; note?: string }>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPageContext({ page: `Cycle count ${count.number}`, selectedSkus: count.lines.map((l) => itemsById.get(l.itemId)?.sku).filter((s): s is string => !!s).slice(0, 60) });
  }, [setPageContext, count.number, count.lines, itemsById]);

  const progress = countProgress(count);
  const showExpected = reveal || count.status !== "open";
  const differences = count.lines.filter((l) => lineVariance(l) !== undefined && lineVariance(l) !== 0);
  const netUnits = differences.reduce((s, l) => s + (lineVariance(l) ?? 0), 0);
  const netValue = differences.reduce((s, l) => s + (lineVariance(l) ?? 0) * (itemsById.get(l.itemId)?.unitCost ?? 0), 0);

  const save = (line: CycleCountLine) => {
    const d = drafts[line.itemId];
    if (!d) return;
    const raw = d.counted;
    const counted = raw === undefined ? undefined : raw.trim() === "" ? null : Number(raw);
    if (counted !== undefined && counted !== null && (!Number.isFinite(counted) || counted < 0)) return;
    setSaving((s) => new Set(s).add(line.itemId));
    recordCounts(store, user, count.id, [{ itemId: line.itemId, counted: counted === undefined ? (line.counted ?? null) : counted, note: d.note }])
      .then(() => setDrafts((prev) => {
        const next = { ...prev };
        delete next[line.itemId];
        return next;
      }))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "critical"))
      .finally(() => setSaving((s) => {
        const next = new Set(s);
        next.delete(line.itemId);
        return next;
      }));
  };
  const queueSave = (line: CycleCountLine) => {
    const t = timers.current.get(line.itemId);
    if (t) clearTimeout(t);
    timers.current.set(line.itemId, setTimeout(() => save(line), 600));
  };
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const complete = async () => {
    setBusy(true);
    try {
      const done = await completeCycleCount(store, user, count.id);
      toast(`${count.number} completed · ${pluralize(done.result?.adjusted ?? 0, "adjustment")} booked`, "success");
      setConfirmComplete(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await cancelCycleCount(store, user, count.id);
      toast(`${count.number} cancelled`, "success");
      router.push("/inventory/counts");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    if (!printCountSheet(count, { items: itemsById, location, companyName: settings.companyName, showExpected })) toast("Allow pop-ups to print the sheet", "critical");
  };
  const compare = () => openAgent(`Compare the counted quantities on ${count.number} with what the system expected${count.lines.some((l) => l.proposed !== undefined) ? " and with your own proposal" : ""}. Explain the biggest differences, what probably caused them, and what to check before I complete the count.`, { send: true });
  const by = (id?: string) => (id ? (members.find((m) => m.id === id)?.name ?? "") : "");

  return (
    <Page
      backHref="/inventory/counts"
      backLabel="Cycle counts"
      title={<span className="font-mono">{count.number}</span>}
      titleMeta={
        <>
          <CountStatusBadge status={count.status} />
          {count.blind && count.status === "open" && <Badge>Blind</Badge>}
          {count.source === "strato" && <Badge tone="magic">Proposed by Strato</Badge>}
        </>
      }
      subtitle={`${count.name ? `${count.name} · ` : ""}${describeScope(count.scope)} at ${location?.name ?? "default location"} · started ${formatRelative(count.createdAt)}${by(count.createdBy) ? ` by ${by(count.createdBy)}` : ""}`}
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Check />} onClick={() => setConfirmComplete(true)} disabled={progress.counted === 0}>
            Complete count
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          <Button icon={<Printer />} onClick={print}>
            Print sheet
          </Button>
          {count.status === "open" && count.blind && (
            <Button icon={reveal ? <EyeOff /> : <Eye />} onClick={() => setReveal((v) => !v)}>
              {reveal ? "Hide expected" : "Show expected"}
            </Button>
          )}
          <Button icon={<Sparkles />} onClick={compare} disabled={progress.counted === 0}>
            Compare with Strato
          </Button>
          {writable && (
            <Button icon={<XCircle />} onClick={() => setConfirmCancel(true)}>
              Cancel count
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-4">
          <Stat label="Counted" value={`${progress.counted} / ${progress.total}`} hint={progress.counted === progress.total ? "Every line counted" : `${progress.total - progress.counted} to go`} />
          <Stat label="Differences" value={String(differences.length)} tone={differences.length ? "warning" : "default"} hint={showExpected ? "Lines where the shelf disagrees" : "Shown when expected is revealed"} />
          <Stat label="Net units" value={showExpected ? `${netUnits >= 0 ? "+" : ""}${netUnits}` : "—"} tone={netUnits < 0 ? "critical" : "default"} hint="Counted minus expected" />
          <Stat label="Net value" value={showExpected ? formatMoney(netValue, settings.currency) : "—"} tone={netValue < 0 ? "critical" : netValue > 0 ? "success" : "default"} hint="At standard cost" />
        </div>
        {count.result && (
          <div className="rounded-[var(--radius)] border border-border bg-surface-subdued px-3.5 py-2.5 text-[13px] text-text-secondary">
            Completed {formatDateTime(count.completedAt!)}{by(count.completedBy) ? ` by ${by(count.completedBy)}` : ""}: {count.result.counted} of {count.lines.length} lines counted, {pluralize(count.result.adjusted, "adjustment")} booked as count movements, net {count.result.varianceUnits >= 0 ? "+" : ""}{count.result.varianceUnits} units ({formatMoney(count.result.varianceValue, settings.currency)}).
          </div>
        )}
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-subdued text-[11.5px] uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left">Bin</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  {showExpected && <th className="px-3 py-2 text-right">Expected</th>}
                  {count.lines.some((l) => l.proposed !== undefined) && showExpected && <th className="px-3 py-2 text-right">Strato</th>}
                  <th className="px-3 py-2 text-right">Counted</th>
                  {showExpected && <th className="px-3 py-2 text-right">Diff</th>}
                  <th className="px-3 py-2 text-left">Note</th>
                </tr>
              </thead>
              <tbody>
                {count.lines.map((l) => {
                  const item = itemsById.get(l.itemId);
                  const d = drafts[l.itemId];
                  const v = lineVariance(l);
                  return (
                    <tr key={l.itemId} className={cn("border-t border-border", l.counted !== undefined && "bg-success-soft/30")}>
                      <td className="px-3 py-1.5 font-mono text-text-secondary">{l.bin ?? "—"}</td>
                      <td className="px-3 py-1.5 font-mono">{item ? <Link href={`/inventory/${item.id}`} className="text-accent hover:underline">{item.sku}</Link> : l.itemId}</td>
                      <td className="max-w-[280px] truncate px-3 py-1.5">{item?.name ?? ""}</td>
                      {showExpected && <td className="px-3 py-1.5 text-right tabular text-text-secondary">{l.expected}</td>}
                      {count.lines.some((x) => x.proposed !== undefined) && showExpected && <td className="px-3 py-1.5 text-right tabular text-text-secondary" title={l.proposedNote}>{l.proposed ?? "—"}</td>}
                      <td className="px-3 py-1.5 text-right">
                        {writable ? (
                          <TextField type="number" min={0} step="any" value={d?.counted ?? (l.counted === undefined ? "" : String(l.counted))} onChange={(e) => { setDrafts((p) => ({ ...p, [l.itemId]: { ...p[l.itemId], counted: e.target.value } })); }} onBlur={() => save(l)} onKeyDown={(e) => e.key === "Enter" && save(l)} containerClassName="ml-auto w-24" className={cn("text-right", saving.has(l.itemId) && "opacity-60")} aria-label={`Counted quantity for ${item?.sku ?? l.itemId}`} placeholder="—" />
                        ) : (
                          <span className="tabular">{l.counted ?? "—"}</span>
                        )}
                      </td>
                      {showExpected && <td className={cn("px-3 py-1.5 text-right tabular font-medium", v === undefined ? "text-text-tertiary" : v === 0 ? "text-success" : v < 0 ? "text-critical" : "text-warning")}>{v === undefined ? "—" : v > 0 ? `+${v}` : v}</td>}
                      <td className="px-3 py-1.5">
                        {writable ? (
                          <TextField value={d?.note ?? l.note ?? ""} onChange={(e) => { setDrafts((p) => ({ ...p, [l.itemId]: { ...p[l.itemId], note: e.target.value } })); queueSave(l); }} onBlur={() => save(l)} placeholder="Damaged, wrong bin…" aria-label="Note" containerClassName="min-w-[160px]" />
                        ) : (
                          <span className="text-text-secondary">{l.note ?? ""}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        {count.note && <p className="text-[13px] text-text-secondary">{count.note}</p>}
        <p className="text-[12px] text-text-tertiary">Counted quantities save as you go, so several people can count at once. Completing books a count movement for every line that differs from the system quantity at that moment; lines left blank are untouched.</p>
      </div>
      <ConfirmDialog
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        onConfirm={complete}
        loading={busy}
        confirmLabel="Complete and adjust"
        title={`Complete ${count.number}?`}
        message={
          <span>
            {progress.counted} of {progress.total} lines were counted. {differences.length ? `${pluralize(differences.length, "line")} differ from the system and will be corrected with count movements at ${location?.name ?? "the location"}, net ${netUnits >= 0 ? "+" : ""}${netUnits} units (${formatMoney(netValue, settings.currency)} at standard cost).` : "Nothing differs, so no stock changes."} Lines left blank are not touched.
          </span>
        }
      />
      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} loading={busy} destructive confirmLabel="Cancel count" title={`Cancel ${count.number}?`} message={<span>Nothing recorded on this count changes stock. The sheet stays on record as cancelled.</span>} />
    </Page>
  );
}

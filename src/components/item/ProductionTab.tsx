"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Item, RoutingStep } from "@/lib/types";
import { updateItem } from "@/lib/inventory";
import { DEFAULT_SERIAL_FORMAT, formatSerial } from "@/lib/serials";
import { cleanRouting } from "@/lib/workOrderSteps";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useLocationName } from "@/lib/locations";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, EmptyState, IconButton, SimpleTable, TextField, Toggle, useToast } from "@/components/ui";
import { SerialLink, SerialStatusBadge } from "@/components/serials/SerialStatusBadge";
import { errorMessage } from "./utils";

/**
 * How an item is made (features `serials` and `workOrderSteps`): whether each unit gets a
 * serial number, and the standard steps copied onto its work orders. Remounted when the
 * saved item changes, so the drafts always start from what is stored.
 */
export function ProductionTab({ item, canEdit, serialsOn, stepsOn }: { item: Item; canEdit: boolean; serialsOn: boolean; stepsOn: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {serialsOn && <SerialSettings key={`${item.tracking}|${item.serialFormat}`} item={item} canEdit={canEdit} />}
      {stepsOn && <RoutingEditor key={JSON.stringify(item.routing ?? [])} item={item} canEdit={canEdit} />}
      {serialsOn && <ItemSerials item={item} />}
    </div>
  );
}

function SerialSettings({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [tracked, setTracked] = useState(item.tracking === "serial");
  const [format, setFormat] = useState(item.serialFormat ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = tracked !== (item.tracking === "serial") || format.trim() !== (item.serialFormat ?? "");
  const preview = formatSerial(format, item.sku, item.serialNext ?? 1);

  const save = async () => {
    setSaving(true);
    try {
      await updateItem(store, user, item.id, { tracking: tracked ? "serial" : "none", serialFormat: format.trim() || undefined }, tracked ? "Serial numbers on" : "Serial numbers off");
      toast(tracked ? `${item.sku} units now get serial numbers` : `${item.sku} is no longer tracked by serial number`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h4 className="mb-1 text-[13px] font-semibold text-text">Serial numbers</h4>
      <p className="mb-3 max-w-[640px] text-[12.5px] text-text-secondary">
        Each unit made on a work order gets its own number when the run is released, with a record of its steps, the parts and batches that went into it, its cost and who bought it.
      </p>
      <Toggle label="Give each unit its own serial number" checked={tracked} onChange={setTracked} disabled={!canEdit} />
      {tracked && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <TextField
            label="Number format"
            value={format}
            placeholder={DEFAULT_SERIAL_FORMAT}
            onChange={(e) => setFormat(e.target.value)}
            disabled={!canEdit}
            containerClassName="w-60"
            className="font-mono"
            help="{SKU} is the item code; {####} is the counter."
          />
          <div className="pb-6 text-[12.5px] text-text-secondary">
            Next: <span className="font-mono text-text">{preview}</span>
          </div>
        </div>
      )}
      {canEdit && dirty && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => { setTracked(item.tracking === "serial"); setFormat(item.serialFormat ?? ""); }}>
            Discard
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      )}
    </section>
  );
}

interface DraftStep {
  name: string;
  workCenter: string;
  outside: boolean;
  days: string;
}

const toDraft = (r: RoutingStep): DraftStep => ({ name: r.name, workCenter: r.workCenter ?? "", outside: !!r.outside, days: r.days ? String(r.days) : "" });
const fromDraft = (d: DraftStep): RoutingStep => ({ name: d.name, workCenter: d.workCenter, outside: d.outside, days: d.days.trim() ? Number(d.days) : undefined });

function RoutingEditor({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftStep[]>(() => (item.routing ?? []).map(toDraft));
  const [saving, setSaving] = useState(false);
  const cleaned = cleanRouting(draft.map(fromDraft));
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(cleanRouting(item.routing ?? []));
  const badDays = draft.some((d) => d.days.trim() !== "" && !(Number(d.days) > 0));
  const unnamed = draft.some((d) => !d.name.trim() && (d.workCenter.trim() || d.days.trim()));

  const update = (idx: number, patch: Partial<DraftStep>) => setDraft((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const move = (idx: number, dir: -1 | 1) =>
    setDraft((rows) => {
      const j = idx + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });

  const save = async () => {
    if (badDays || unnamed) return;
    setSaving(true);
    try {
      await updateItem(store, user, item.id, { routing: cleaned.length ? cleaned : undefined }, "Standard steps edited");
      toast(`Saved ${cleaned.length} ${cleaned.length === 1 ? "step" : "steps"} for ${item.sku}`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  const input = "h-7 w-full rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/20";

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-text">Standard steps</h4>
        {canEdit && dirty && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDraft((item.routing ?? []).map(toDraft))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={saving} disabled={badDays || unnamed} onClick={() => void save()}>
              Save steps
            </Button>
          </div>
        )}
      </div>
      <p className="mb-3 max-w-[640px] text-[12.5px] text-text-secondary">
        Copied onto each work order for {item.sku} when it is released, with dates laid end to end from the run&apos;s start. Mark a step as outside when a vendor does it.
      </p>
      <SimpleTable>
        <thead>
          <tr>
            <th className="w-10 text-right">#</th>
            <th>Step</th>
            <th>Where</th>
            <th className="w-20 text-center">Outside</th>
            <th className="w-24 text-right">Days</th>
            {canEdit && <th className="w-28" />}
          </tr>
        </thead>
        <tbody>
          {draft.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 6 : 5} className="py-5 text-center text-text-tertiary">
                No standard steps. Work orders for this item can still get steps one by one.
              </td>
            </tr>
          )}
          {draft.map((d, idx) => (
            <tr key={idx}>
              <td className="text-right tabular text-text-tertiary">{idx + 1}</td>
              <td>{canEdit ? <input className={cn(input, unnamed && !d.name.trim() && "border-critical")} value={d.name} placeholder="e.g. Weld" onChange={(e) => update(idx, { name: e.target.value })} aria-label={`Step ${idx + 1} name`} /> : d.name}</td>
              <td>{canEdit ? <input className={input} value={d.workCenter} placeholder="e.g. Fab bay" onChange={(e) => update(idx, { workCenter: e.target.value })} aria-label={`Step ${idx + 1} work center`} /> : d.workCenter || <span className="text-text-tertiary">—</span>}</td>
              <td className="text-center">
                <input type="checkbox" checked={d.outside} disabled={!canEdit} onChange={(e) => update(idx, { outside: e.target.checked })} aria-label={`Step ${idx + 1} done by an outside vendor`} />
              </td>
              <td className="text-right">
                {canEdit ? (
                  <input className={cn(input, "w-20 text-right tabular", d.days.trim() !== "" && !(Number(d.days) > 0) && "border-critical")} type="number" min={1} step={1} value={d.days} onChange={(e) => update(idx, { days: e.target.value })} aria-label={`Step ${idx + 1} days`} />
                ) : (
                  d.days || <span className="text-text-tertiary">—</span>
                )}
              </td>
              {canEdit && (
                <td className="text-right">
                  <span className="inline-flex items-center gap-0.5">
                    <IconButton variant="plain" size="sm" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Move step ${idx + 1} up`}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton variant="plain" size="sm" disabled={idx === draft.length - 1} onClick={() => move(idx, 1)} aria-label={`Move step ${idx + 1} down`}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton variant="plain" size="sm" onClick={() => setDraft((rows) => rows.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-critical" aria-label={`Remove step ${idx + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </SimpleTable>
      {canEdit && (
        <Button size="sm" variant="plain" icon={<Plus />} className="mt-2" onClick={() => setDraft((rows) => [...rows, { name: "", workCenter: "", outside: false, days: "" }])}>
          Add a step
        </Button>
      )}
    </section>
  );
}

function ItemSerials({ item }: { item: Item }) {
  const serials = useCollection("serials");
  const locationName = useLocationName();
  const mine = useMemo(() => serials.filter((s) => s.itemId === item.id).sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true })), [serials, item.id]);
  return (
    <section>
      <h4 className="mb-2 text-[13px] font-semibold text-text">Units by serial number</h4>
      {mine.length === 0 ? (
        <EmptyState title="No serial numbers yet" description={item.tracking === "serial" ? "They are created when a work order for this item is released." : "Turn on serial numbers above, then release a work order."} />
      ) : (
        <SimpleTable>
          <thead>
            <tr>
              <th>Serial</th>
              <th>Status</th>
              <th>Where</th>
              <th className="text-right">Finished</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((s) => {
              const parent = s.parentSerialId ? serials.find((p) => p.id === s.parentSerialId) : undefined;
              return (
                <tr key={s.id}>
                  <td>
                    <SerialLink serial={s} />
                  </td>
                  <td>
                    <SerialStatusBadge status={s.status} />
                  </td>
                  <td className="text-text-secondary">
                    {s.status === "shipped" ? s.customer ?? "Customer" : s.status === "installed" && parent ? <>In <SerialLink serial={parent} /></> : s.status === "in_stock" ? locationName(s.locationId) : "—"}
                  </td>
                  <td className="text-right tabular text-text-secondary">{s.finishedAt ? formatDate(s.finishedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </SimpleTable>
      )}
    </section>
  );
}

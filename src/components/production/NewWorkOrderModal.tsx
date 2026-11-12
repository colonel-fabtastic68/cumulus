"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { BomSelection, Item, WorkOrder } from "@/lib/types";
import { explodeBom, isOrderOpen, openQty } from "@/lib/inventory";
import { createWorkOrder } from "@/lib/workOrders";
import { hasBomOptions } from "@/lib/bomOptions";
import { jobIsOpen } from "@/lib/jobs";
import { useCollection, useItems, useStore } from "@/lib/store/provider";
import { useLocations } from "@/lib/locations";
import { useCurrentUser } from "@/lib/auth";
import { useFeature } from "@/lib/useFeature";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, Checkbox, FormGrid, Modal, Select, SimpleTable, TextArea, TextField, Toggle, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { BomOptionsPicker } from "@/components/builds/BomOptionsPicker";
import { PRIORITY_OPTIONS } from "./workOrderUtils";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Start with this assembly chosen (from the BOM page or a short sales order). */
  assembly?: Item | null;
  onCreated?: (wo: WorkOrder) => void;
}

/** Mounts the form only while open so every opening starts clean. */
export function NewWorkOrderModal(props: Props) {
  if (!props.open) return null;
  return <WorkOrderForm {...props} />;
}

function WorkOrderForm({ open, onClose, assembly: preset, onCreated }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const orders = useCollection("orders");
  const jobs = useCollection("jobs");
  const members = useCollection("members");
  const locations = useLocations();
  const jobsEnabled = useFeature("jobs");

  const [assembly, setAssembly] = useState<Item | null>(preset ?? null);
  const [qty, setQty] = useState("1");
  const [startOn, setStartOn] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<NonNullable<WorkOrder["priority"]>>("normal");
  const [locationId, setLocationId] = useState("");
  const [consumeSub, setConsumeSub] = useState(true);
  const [selection, setSelection] = useState<BomSelection>({});
  const [orderId, setOrderId] = useState("");
  const [jobId, setJobId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [release, setRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => (assembly ? (items.find((i) => i.id === assembly.id) ?? assembly) : null), [items, assembly]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const raw = Number(qty);
  const n = Number.isInteger(raw) && raw > 0 ? raw : 0;
  const modular = !!live && hasBomOptions(live);
  const options = modular ? selection : undefined;
  const reqs = useMemo(() => (live && n > 0 ? explodeBom(items, live, n, { consumeSubassemblies: consumeSub, explodeShortfallOnly: !consumeSub, selection: options }) : []), [items, live, n, consumeSub, options]);
  const shortages = reqs.filter((r) => r.shortage > 0);
  const datesWrong = !!startOn && !!dueOn && dueOn < startOn;
  // Open sales orders still waiting on this assembly: the run can be tied to one.
  const waiting = useMemo(() => (live ? orders.filter((o) => isOrderOpen(o) && o.lines.some((l) => l.itemId === live.id && openQty(l) > 0)) : []), [orders, live]);
  const openJobs = useMemo(() => jobs.filter(jobIsOpen).sort((a, b) => a.number.localeCompare(b.number)), [jobs]);

  const submit = async () => {
    if (!live) return setError("Choose the assembly to build");
    if (n <= 0) return setError("Enter a whole-number quantity");
    if (datesWrong) return setError("The due date is before the start date");
    setBusy(true);
    setError(null);
    try {
      const wo = await createWorkOrder(store, user, {
        assemblyId: live.id,
        qty: n,
        startOn: startOn || undefined,
        dueOn: dueOn || undefined,
        priority,
        locationId: locationId || undefined,
        consumeSubassemblies: consumeSub,
        options: modular ? selection : undefined,
        orderId: orderId || undefined,
        jobId: jobId || undefined,
        assignedTo: assignee ? [assignee] : undefined,
        note,
        release,
      });
      toast(`${release ? "Released" : "Planned"} ${wo.number}: ${n} × ${live.sku}`, "success");
      onCreated?.(wo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New work order"
      subtitle="Plan a production run. Stock moves when units are completed, not before."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!live || n <= 0 || datesWrong}>
            {release ? "Create and release" : "Plan work order"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <ItemPicker
              label="Assembly"
              value={live}
              onChange={(a) => {
                setAssembly(a);
                setSelection({});
                setOrderId("");
              }}
              filter={(i) => i.type === "assembly" && i.bom.length > 0 && i.status === "active"}
              autoFocus={!preset}
            />
          </div>
          <TextField label="Quantity" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} error={qty.trim() !== "" && n === 0 ? "Whole numbers only" : undefined} autoFocus={!!preset} />
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Start" hint="(optional)" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          <TextField label="Due" hint="(optional)" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} error={datesWrong ? "Before the start date" : undefined} />
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} options={PRIORITY_OPTIONS} />
        </FormGrid>
        <FormGrid cols={3}>
          {locations.length > 1 && <Select label="Build at" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={[{ value: "", label: `${locations[0]!.name} (default)` }, ...locations.slice(1).map((l) => ({ value: l.id, label: l.name }))]} />}
          <Select label="Assigned to" value={assignee} onChange={(e) => setAssignee(e.target.value)} options={[{ value: "", label: "Nobody yet" }, ...members.filter((m) => m.status === "active").map((m) => ({ value: m.id, label: m.name }))]} />
          {waiting.length > 0 && <Select label="For sales order" value={orderId} onChange={(e) => setOrderId(e.target.value)} options={[{ value: "", label: "Stock (no order)" }, ...waiting.map((o) => ({ value: o.id, label: `${o.number} · ${o.customer}` }))]} />}
          {jobsEnabled && openJobs.length > 0 && <Select label="Job" value={jobId} onChange={(e) => setJobId(e.target.value)} options={[{ value: "", label: "No job" }, ...openJobs.map((j) => ({ value: j.id, label: `${j.number} · ${j.name}` }))]} />}
        </FormGrid>
        {live && modular && <BomOptionsPicker bom={live.bom} value={selection} onChange={setSelection} itemsById={byId} />}
        <div className="rounded-[var(--radius)] border border-border p-3">
          <Toggle label="Pull sub-assemblies from stock" help={consumeSub ? "Sub-assemblies on the BOM are taken from their own shelf stock." : "Sub-assemblies are built from base parts when their stock runs out."} checked={consumeSub} onChange={setConsumeSub} />
        </div>
        {live && n > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
              <span className="font-medium">Parts the run needs</span>
              {shortages.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> {shortages.length} short today
                </span>
              ) : (
                <span className="text-success">All on the shelf today</span>
              )}
            </div>
            <SimpleTable>
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="text-right">Required</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Short</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.item.id} className={cn(r.shortage > 0 && "bg-warning-soft/40")}>
                    <td>
                      <span className="font-mono text-[12px] text-text-secondary">{r.item.sku}</span> {r.item.name}
                    </td>
                    <td className="text-right tabular">{formatQty(r.required, r.item.unit)}</td>
                    <td className="text-right tabular">{formatQty(r.available, r.item.unit)}</td>
                    <td className={cn("text-right tabular", r.shortage > 0 ? "font-medium text-warning" : "text-text-tertiary")}>{r.shortage > 0 ? formatQty(r.shortage, r.item.unit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
            {shortages.length > 0 && <p className="mt-1 text-[12px] text-text-tertiary">A run can be planned and released while parts are short; the short parts must be on the shelf before units are completed.</p>}
          </div>
        )}
        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <Checkbox label="Release now" help="Fixes the parts list from the BOM as it stands and commits the parts. Leave off to keep the run as a plan that follows BOM changes." checked={release} onChange={setRelease} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}

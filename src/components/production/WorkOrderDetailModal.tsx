"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, PlayCircle, XCircle } from "lucide-react";
import type { WorkOrder } from "@/lib/types";
import { cancelWorkOrder, completeWorkOrder, releaseWorkOrder, workOrderIsOpen, workOrderNeeds, workOrderRemaining } from "@/lib/workOrders";
import { describeBomSelection } from "@/lib/bomOptions";
import { bomPickList, printPickSheet } from "@/lib/pickList";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { useLocationName } from "@/lib/locations";
import { useFeature } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { formatDate, formatDateTime, formatQty, fromDateInput, toDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth";
import { Badge, Button, ConfirmDialog, DescriptionList, Modal, SimpleTable, TextField, useToast } from "@/components/ui";
import { DueCell, ProgressCell, WorkOrderStatusBadge } from "./workOrderUtils";

/** Mounts only while a run is selected and remounts per run. */
export function WorkOrderDetailModal({ workOrder, onClose, canWrite }: { workOrder: WorkOrder | null; onClose: () => void; canWrite: boolean }) {
  if (!workOrder) return null;
  return <Detail key={workOrder.id} wo={workOrder} onClose={onClose} canWrite={canWrite} />;
}

function Detail({ wo, onClose, canWrite }: { wo: WorkOrder; onClose: () => void; canWrite: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const locations = useCollection("locations");
  const builds = useCollection("builds");
  const orders = useCollection("orders");
  const jobs = useCollection("jobs");
  const members = useCollection("members");
  const settings = useSettings();
  const locationName = useLocationName();
  const pickLists = useFeature("pickLists");
  const terms = useTerms();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const assembly = byId.get(wo.assemblyId);
  const open = workOrderIsOpen(wo);
  const remaining = workOrderRemaining(wo);
  const needs = useMemo(() => workOrderNeeds(wo, items), [wo, items]);
  const short = needs.filter((n) => n.shortage > 0);
  const myBuilds = builds.filter((b) => b.workOrderId === wo.id).sort((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt));
  const order = orders.find((o) => o.id === wo.orderId);
  const job = jobs.find((j) => j.id === wo.jobId);
  const assigned = (wo.assignedTo ?? []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(", ");

  const [qty, setQty] = useState(String(remaining));
  const [date, setDate] = useState(toDateInput());
  const [busy, setBusy] = useState<"release" | "complete" | "cancel" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const n = Number(qty);
  const qtyOk = Number.isInteger(n) && n > 0 && n <= remaining;
  // Whether the parts on the shelf cover the units being booked now (the rest of the run may still be short).
  const coversNow = qtyOk && needs.every((x) => x.available >= (x.required / remaining) * n - 1e-9);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string>) => {
    setBusy(kind);
    try {
      toast(await fn(), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const release = () => run("release", async () => `Released ${(await releaseWorkOrder(store, user, wo.id)).number}`);
  const complete = () =>
    run("complete", async () => {
      const res = await completeWorkOrder(store, user, wo.id, { qty: n, occurredAt: date === toDateInput() ? undefined : fromDateInput(date) });
      setQty(String(workOrderRemaining(res.workOrder) || 1));
      return res.workOrder.status === "completed" ? `${wo.number} is complete (${res.buildNumber})` : `Booked ${n} on ${wo.number} (${res.buildNumber})`;
    });
  const cancel = () =>
    run("cancel", async () => {
      await cancelWorkOrder(store, user, wo.id);
      setConfirmCancel(false);
      return `Cancelled ${wo.number}`;
    });

  const printPick = () => {
    if (!assembly || remaining <= 0) return;
    const lines = bomPickList(assembly, remaining, { items, locations }, { selection: wo.options, consumeSubassemblies: wo.consumeSubassemblies, locationId: wo.locationId });
    const chosen = describeBomSelection(assembly.bom, wo.options, (id) => byId.get(id)?.name ?? id);
    if (!printPickSheet({ title: `Pick list ${wo.number}`, subtitle: `${remaining} × ${assembly.sku} ${assembly.name}`, companyName: settings.companyName, itemCodeLabel: terms.itemCodeShort, lines, note: [chosen, wo.note].filter(Boolean).join("\n") || undefined })) toast("Allow pop-ups to print the pick list", "critical");
  };

  const chosen = assembly ? describeBomSelection(assembly.bom, wo.options, (id) => byId.get(id)?.name ?? id) : "";

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{wo.number}</span>
          <WorkOrderStatusBadge status={wo.status} />
          {wo.priority === "high" && open && <Badge tone="warning">High priority</Badge>}
        </span>
      }
      subtitle={assembly ? `${wo.qty} × ${assembly.sku} · ${assembly.name}` : "The assembly no longer exists"}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1">
            {pickLists && open && assembly && (
              <Button variant="plain" icon={<ClipboardList />} onClick={printPick}>
                Pick list
              </Button>
            )}
          </div>
          {canWrite && open && (
            <Button icon={<XCircle />} onClick={() => setConfirmCancel(true)} disabled={!!busy}>
              Cancel run
            </Button>
          )}
          {canWrite && wo.status === "planned" && (
            <Button icon={<PlayCircle />} onClick={() => void release()} loading={busy === "release"} disabled={!!busy}>
              Release
            </Button>
          )}
          <Button variant={open && canWrite ? "secondary" : "primary"} onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList
            rows={[
              {
                label: "Assembly",
                value: assembly ? (
                  <Link href={`/inventory/${assembly.id}`} className="font-mono text-[12.5px] text-accent hover:underline">
                    {assembly.sku}
                  </Link>
                ) : (
                  "—"
                ),
              },
              { label: "Progress", value: <ProgressCell wo={wo} /> },
              { label: "Build at", value: locationName(wo.locationId) },
              ...(chosen ? [{ label: "Options", value: <span className="text-[12.5px]">{chosen}</span> }] : []),
            ]}
          />
          <DescriptionList
            rows={[
              { label: "Start", value: wo.startOn ? formatDate(wo.startOn) : <span className="text-text-tertiary">—</span> },
              { label: "Due", value: <DueCell wo={wo} /> },
              { label: "Assigned to", value: assigned || <span className="text-text-tertiary">Nobody yet</span> },
              ...(order ? [{ label: "For order", value: <Link href={`/orders?highlight=${order.id}`} className="text-accent hover:underline">{`${order.number} · ${order.customer}`}</Link> }] : []),
              ...(job ? [{ label: "Job", value: <Link href={`/jobs?highlight=${job.id}`} className="text-accent hover:underline">{`${job.number} · ${job.name}`}</Link> }] : []),
            ]}
          />
        </div>

        {canWrite && open && assembly && (
          <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-3">
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Units finished" type="number" min={1} max={remaining} step={1} value={qty} onChange={(e) => setQty(e.target.value)} containerClassName="w-32" error={qty.trim() !== "" && !qtyOk ? `1 to ${remaining}` : undefined} />
              <TextField label="On" type="date" max={toDateInput()} value={date} onChange={(e) => setDate(e.target.value)} containerClassName="w-44" />
              <Button variant="primary" icon={<CheckCircle2 />} onClick={() => void complete()} loading={busy === "complete"} disabled={!qtyOk || !coversNow || !!busy}>
                {qtyOk && n === remaining ? "Complete the run" : "Book finished units"}
              </Button>
            </div>
            <p className={cn("mt-1.5 text-[12px]", qtyOk && !coversNow ? "text-warning" : "text-text-tertiary")}>
              {qtyOk && !coversNow ? `Not enough parts on the shelf for ${n}: short on ${short.map((s) => s.item.sku).join(", ")}.` : `Takes the parts out of stock and puts ${qtyOk ? n : "the"} finished ${n === 1 ? "unit" : "units"} on the shelf as a build.${wo.status === "planned" ? " The run is released first." : ""}`}
            </p>
          </div>
        )}

        {needs.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="font-semibold text-text">Parts still needed</span>
              {short.length > 0 ? <span className="text-[12.5px] text-warning">{short.length} short</span> : <span className="text-[12.5px] text-success">All on the shelf</span>}
            </div>
            <SimpleTable>
              <thead>
                <tr>
                  <th>{terms.itemCodeShort}</th>
                  <th>Item</th>
                  <th className="text-right">Needed</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Short</th>
                </tr>
              </thead>
              <tbody>
                {needs.map((x) => (
                  <tr key={x.item.id} className={cn(x.shortage > 0 && "bg-warning-soft/40")}>
                    <td>
                      <Link href={`/inventory/${x.item.id}`} className="font-mono text-[12px] text-accent hover:underline">
                        {x.item.sku}
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate text-text-secondary">{x.item.name}</td>
                    <td className="text-right tabular">{formatQty(x.required, x.item.unit)}</td>
                    <td className="text-right tabular text-text-secondary">{formatQty(x.available, x.item.unit)}</td>
                    <td className={cn("text-right tabular", x.shortage > 0 ? "font-medium text-warning" : "text-text-tertiary")}>{x.shortage > 0 ? formatQty(x.shortage, x.item.unit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
            {wo.status === "planned" && <p className="mt-1 text-[12px] text-text-tertiary">Planned: this list follows the BOM until the run is released.</p>}
          </div>
        )}

        {myBuilds.length > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-text">Builds booked</div>
            <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
              {myBuilds.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
                  <Link href={`/builds?highlight=${b.id}`} className="font-mono font-medium text-accent hover:underline">
                    {b.number}
                  </Link>
                  <span className="text-text">{formatQty(b.qty, assembly?.unit)} built</span>
                  <span className="text-text-secondary">{formatDateTime(b.completedAt ?? b.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {wo.note && (
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Note</div>
            <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{wo.note}</p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void cancel()}
        loading={busy === "cancel"}
        title={`Cancel ${wo.number}?`}
        confirmLabel="Cancel run"
        destructive
        message={wo.qtyCompleted > 0 ? `${wo.qtyCompleted} finished units stay in stock. The remaining ${remaining} are dropped and their parts are no longer committed.` : "Nothing has been built yet, so no stock changes. The parts are no longer committed."}
      />
    </Modal>
  );
}

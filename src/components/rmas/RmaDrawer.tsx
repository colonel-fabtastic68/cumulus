"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Rma, RmaCondition, RmaDisposition, RmaStatus } from "@/lib/types";
import { resolveRma } from "@/lib/inventory";
import { useCollection, useDoc, useItemsById, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatDateTime, formatQty } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, DescriptionList, Drawer, Select, SimpleTable, StatusBadge, TextArea, useToast, type BadgeTone } from "@/components/ui";
import { RMA_CONDITIONS } from "./NewRmaModal";

const DISPOSITIONS: Array<{ value: RmaDisposition; label: string }> = [
  { value: "restock", label: "Restock" },
  { value: "refund", label: "Refund" },
  { value: "scrap", label: "Scrap" },
];

const DISPOSITION_TONE: Record<RmaDisposition, BadgeTone> = { restock: "success", refund: "default", scrap: "critical" };

const isOpenStatus = (status: RmaStatus) => status === "open" || status === "inspecting";

interface RmaDrawerProps {
  rmaId: string | null;
  onClose: () => void;
}

/** Slide-over for one RMA. Remounts per ticket so working state never leaks between tickets. */
export function RmaDrawer({ rmaId, onClose }: RmaDrawerProps) {
  const rma = useDoc("rmas", rmaId ?? undefined);
  if (!rma) return null;
  return <RmaDrawerInner key={rma.id} rma={rma} onClose={onClose} />;
}

function RmaDrawerInner({ rma, onClose }: { rma: Rma; onClose: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const itemsById = useItemsById();
  const members = useCollection("members");

  const [dispositions, setDispositions] = useState<Record<string, RmaDisposition | "">>(() => Object.fromEntries(rma.lines.map((l) => [l.itemId, l.disposition ?? ""])));
  const [conditions, setConditions] = useState<Record<string, RmaCondition>>(() => Object.fromEntries(rma.lines.map((l) => [l.itemId, l.condition])));
  const [note, setNote] = useState(rma.note ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = isOpenStatus(rma.status);
  const editable = open && canWrite(user);
  const allChosen = rma.lines.every((l) => !!dispositions[l.itemId]);
  const openedBy = members.find((m) => m.id === rma.createdBy)?.name;
  const totalUnits = sum(rma.lines.map((l) => l.qty));

  const plan = useMemo(() => {
    const rows = rma.lines.map((l) => {
      const item = itemsById.get(l.itemId);
      const disposition = (dispositions[l.itemId] || "refund") as RmaDisposition;
      return { itemId: l.itemId, sku: item?.sku ?? l.itemId, qty: formatQty(l.qty, item?.unit), disposition };
    });
    const restock = rows.some((r) => r.disposition === "restock");
    const scrap = rows.some((r) => r.disposition === "scrap");
    const status: RmaStatus = restock ? "restocked" : scrap ? "scrapped" : "refunded";
    return { rows, status };
  }, [rma.lines, itemsById, dispositions]);

  const markInspecting = async () => {
    setBusy(true);
    try {
      const trimmed = note.trim();
      await store.patch("rmas", rma.id, { status: "inspecting", ...(trimmed !== (rma.note ?? "") ? { note: trimmed || undefined } : {}) });
      toast(`${rma.number} marked as inspecting`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    try {
      const result = await resolveRma(
        store,
        user,
        rma.id,
        rma.lines.map((l) => ({ itemId: l.itemId, disposition: (dispositions[l.itemId] || "refund") as RmaDisposition, condition: conditions[l.itemId] })),
        note.trim() || undefined,
      );
      const restocked = sum(result.lines.filter((l) => l.disposition === "restock").map((l) => l.qty));
      toast(`${result.number} resolved · ${result.status}${restocked ? ` · ${restocked} restocked` : ""}`, "success");
      setConfirmOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const verb = (d: RmaDisposition) => (d === "restock" ? "will be restocked" : d === "scrap" ? "will be scrapped" : "will be refunded (no stock change)");

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width={520}
        title={
          <span className="inline-flex items-center gap-2">
            <span>{rma.number}</span>
            <StatusBadge status={rma.status} />
          </span>
        }
        subtitle={`${rma.customer} · ${totalUnits} ${totalUnits === 1 ? "unit" : "units"}`}
        footer={
          editable ? (
            <>
              <Button onClick={markInspecting} disabled={busy || rma.status === "inspecting"} icon={<Search />}>
                {rma.status === "inspecting" ? "Inspecting" : "Mark as inspecting"}
              </Button>
              <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy || !allChosen}>
                Resolve RMA
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          <DescriptionList
            rows={[
              { label: "Customer", value: rma.customer },
              { label: "Reference", value: rma.reference ? <span className="font-mono text-[12.5px]">{rma.reference}</span> : "—" },
              { label: "Reason", value: <span className="whitespace-normal">{rma.reason}</span> },
              { label: "Opened", value: `${formatDateTime(rma.createdAt)}${openedBy ? ` by ${openedBy}` : ""}` },
              ...(rma.resolvedAt ? [{ label: "Resolved", value: formatDateTime(rma.resolvedAt) }] : []),
            ]}
          />

          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-text">Lines</div>
            <SimpleTable>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th>Condition</th>
                  <th>Disposition</th>
                </tr>
              </thead>
              <tbody>
                {rma.lines.map((l) => {
                  const item = itemsById.get(l.itemId);
                  const condition = conditions[l.itemId] ?? l.condition;
                  const disposition = dispositions[l.itemId] ?? l.disposition ?? "";
                  return (
                    <tr key={l.itemId}>
                      <td className="align-top">
                        {item ? (
                          <Link href={"/inventory/" + item.id} className="font-mono text-[12px] text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                            {item.sku}
                          </Link>
                        ) : (
                          <span className="font-mono text-[12px] text-text-tertiary">{l.itemId}</span>
                        )}
                        <div className="max-w-[180px] truncate text-[12px] text-text-secondary">{item?.name ?? "Item no longer exists"}</div>
                      </td>
                      <td className="text-right align-top tabular">{formatQty(l.qty, item?.unit)}</td>
                      <td className="align-top">
                        {editable ? (
                          <Select value={condition} onChange={(e) => setConditions((p) => ({ ...p, [l.itemId]: e.target.value as RmaCondition }))} options={RMA_CONDITIONS} aria-label="Condition" />
                        ) : (
                          <span className="capitalize">{l.condition}</span>
                        )}
                      </td>
                      <td className="align-top">
                        {editable ? (
                          <Select value={disposition} onChange={(e) => setDispositions((p) => ({ ...p, [l.itemId]: e.target.value as RmaDisposition | "" }))} options={DISPOSITIONS} placeholder="Choose…" aria-label="Disposition" />
                        ) : l.disposition ? (
                          <Badge tone={DISPOSITION_TONE[l.disposition]}>{DISPOSITIONS.find((d) => d.value === l.disposition)?.label}</Badge>
                        ) : (
                          <span className="text-text-tertiary">Pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </SimpleTable>
            {editable ? (
              <p className="mt-1.5 text-[12px] text-text-tertiary">
                <span className="font-medium text-text-secondary">Restock</span> puts the units back on the shelf automatically when you resolve. <span className="font-medium text-text-secondary">Refund</span> and <span className="font-medium text-text-secondary">scrap</span> leave stock untouched.
                {!allChosen && <span className="block text-warning">Choose a disposition for every line to resolve.</span>}
              </p>
            ) : open ? (
              <p className="mt-1.5 text-[12px] text-text-tertiary">Dispositions are chosen when the RMA is resolved.</p>
            ) : null}
          </div>

          {editable ? (
            <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was found on inspection, replacement shipped, etc." />
          ) : rma.note ? (
            <div>
              <div className="mb-1 text-[12.5px] font-medium text-text">Note</div>
              <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{rma.note}</p>
            </div>
          ) : null}

          {open && !canWrite(user) && <p className="text-[12px] text-text-tertiary">Viewers can see returns but can&apos;t resolve them.</p>}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={resolve}
        title={`Resolve ${rma.number}?`}
        confirmLabel="Resolve RMA"
        loading={busy}
        message={
          <div className="flex flex-col gap-2">
            <ul className="list-disc pl-5">
              {plan.rows.map((r) => (
                <li key={r.itemId}>
                  <span className="tabular">{r.qty}</span> × <span className="font-mono text-[12.5px] text-text">{r.sku}</span> {verb(r.disposition)}
                </li>
              ))}
            </ul>
            <p>
              The ticket will be marked <StatusBadge status={plan.status} /> and can&apos;t be reopened. Restocked units are added to the stock ledger with a new lot.
            </p>
          </div>
        }
      />
    </>
  );
}

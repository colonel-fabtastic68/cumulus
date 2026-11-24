"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Hash } from "lucide-react";
import { asBuilt, serialCost, serialTimeline, SERIAL_UNFINISHED } from "@/lib/serials";
import { addSerialNote } from "@/lib/serialActions";
import { describeBomSelection } from "@/lib/bomOptions";
import { lotLabel } from "@/lib/traceability";
import { stepStatusLine } from "@/lib/workOrderSteps";
import { workOrderIsOpen } from "@/lib/workOrders";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { useFeature } from "@/lib/useFeature";
import { useLocationName } from "@/lib/locations";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Button, Card, CardHeader, DescriptionList, EmptyState, Page, SimpleTable, TextArea, useToast } from "@/components/ui";
import { SerialLink, SerialStatusBadge } from "@/components/serials/SerialStatusBadge";

/** One unit's record (feature `serials`): what it is, where it is, its history and what went into it. */
export default function SerialPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const enabled = useFeature("serials");
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { currency } = useSettings();
  const { setPageContext } = useAgent();
  const serials = useCollection("serials");
  const events = useCollection("serialEvents");
  const lots = useCollection("lots");
  const builds = useCollection("builds");
  const movements = useCollection("movements");
  const workOrders = useCollection("workOrders");
  const orders = useCollection("orders");
  const jobs = useCollection("jobs");
  const itemsById = useItemsById();
  const locationName = useLocationName();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // The record opens by id, or by the serial number itself (handy for typed links and scans).
  const serial = useMemo(() => serials.find((s) => s.id === id) ?? serials.find((s) => s.number.toUpperCase() === id.toUpperCase()), [serials, id]);
  useEffect(() => {
    if (serial) setPageContext({ page: `Serial ${serial.number}` });
  }, [serial, setPageContext]);

  const timeline = useMemo(() => (serial ? serialTimeline(events, serial.id) : []), [events, serial]);
  const parts = useMemo(() => (serial ? asBuilt(serial, { builds, movements, serials }) : []), [serial, builds, movements, serials]);

  if (!enabled || !serial) {
    return (
      <Page title={enabled ? "Serial number not found" : "Serial numbers"} backHref="/serials" backLabel="Serial numbers">
        <Card padded={false}>
          <EmptyState icon={<Hash />} title={enabled ? "We couldn't find that serial number" : "Serial numbers are not switched on"} description={enabled ? "It may have been cancelled with its work order, or the link is out of date." : "This feature is still in preview."} action={<Button href="/serials">All serial numbers</Button>} />
        </Card>
      </Page>
    );
  }

  const item = itemsById.get(serial.itemId);
  const wo = workOrders.find((w) => w.id === serial.workOrderId);
  const build = builds.find((b) => b.id === serial.buildId);
  const order = orders.find((o) => o.id === serial.orderId);
  const job = jobs.find((j) => j.id === serial.jobId);
  const parent = serials.find((s) => s.id === serial.parentSerialId);
  const lot = lots.find((l) => l.id === serial.lotId);
  const cost = serialCost(serial, lots);
  const options = item && serial.options ? describeBomSelection(item.bom, serial.options, (iid) => itemsById.get(iid)?.name ?? iid) : "";
  const stepLine = wo && workOrderIsOpen(wo) && SERIAL_UNFINISHED.includes(serial.status) ? stepStatusLine(wo) : undefined;
  const where =
    serial.status === "shipped" ? `With ${serial.customer ?? "the customer"}` : serial.status === "installed" ? undefined : serial.status === "in_stock" ? locationName(serial.locationId) : serial.status === "voided" ? "Never made" : stepLine ?? "On the work order";

  const saveNote = async () => {
    setSaving(true);
    try {
      await addSerialNote(store, user, serial.id, note);
      setNote("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  const link = "text-accent hover:underline";
  return (
    <Page backHref="/serials" backLabel="Serial numbers" title={<span className="font-mono">{serial.number}</span>} titleMeta={<SerialStatusBadge status={serial.status} />} subtitle={item ? `${item.sku} · ${item.name}` : "Deleted item"}>
      <div className="flex flex-col gap-4">
        <Card>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <DescriptionList
              rows={[
                { label: "Item", value: item ? <Link href={`/inventory/${item.id}`} className={`font-mono text-[12.5px] ${link}`}>{item.sku}</Link> : "—" },
                { label: "Where", value: serial.status === "installed" && parent ? <>Built into <SerialLink serial={parent} /></> : where },
                { label: "Work order", value: wo ? <Link href={`/builds/work-orders?highlight=${wo.id}`} className={link}>{wo.number}</Link> : <span className="text-text-tertiary">—</span> },
                ...(build ? [{ label: "Build", value: <Link href={`/builds?highlight=${build.id}`} className={link}>{build.number}</Link> }] : []),
                { label: "Finished", value: serial.finishedAt ? formatDate(serial.finishedAt) : <span className="text-text-tertiary">Not yet</span> },
                ...(options ? [{ label: "Built with", value: <span className="text-[12.5px]">{options}</span> }] : []),
              ]}
            />
            <DescriptionList
              rows={[
                { label: "Cost", value: cost !== undefined ? <>{formatMoney(cost, currency)}{lot ? <span className="text-text-tertiary"> · batch {lotLabel(lot)}</span> : null}</> : <span className="text-text-tertiary">When finished</span> },
                { label: "Customer", value: serial.customer ?? (order ? order.customer : <span className="text-text-tertiary">—</span>) },
                ...(order ? [{ label: "Order", value: <Link href={`/orders?highlight=${order.id}`} className={link}>{order.number}</Link> }] : []),
                ...(serial.shippedAt ? [{ label: "Shipped", value: formatDate(serial.shippedAt) }] : []),
                ...(job ? [{ label: "Job", value: <Link href={`/jobs?highlight=${job.id}`} className={link}>{`${job.number} · ${job.name}`}</Link> }] : []),
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="What went into it" subtitle={build ? `The parts ${build.number} consumed, the batches they came from, and the numbered units built in.` : "Recorded when the unit is finished on its work order."} />
          {parts.length === 0 ? (
            <p className="text-[12.5px] text-text-tertiary">Nothing recorded yet.</p>
          ) : (
            <SimpleTable>
              <thead>
                <tr>
                  <th>Part</th>
                  <th className="text-right">Qty</th>
                  <th>Batches</th>
                  <th>Serial numbers</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => {
                  const part = itemsById.get(p.itemId);
                  return (
                    <tr key={p.itemId}>
                      <td>
                        {part ? <Link href={`/inventory/${part.id}`} className={`font-mono text-[12px] ${link}`}>{part.sku}</Link> : "Deleted part"}
                        {part && <span className="ml-1.5 text-text-secondary">{part.name}</span>}
                      </td>
                      <td className="text-right tabular">{formatQty(p.qty, part?.unit)}</td>
                      <td className="text-[12.5px] text-text-secondary">{p.lots.length ? p.lots.map((l) => { const found = lots.find((x) => x.id === l.lotId); return found ? lotLabel(found) : "batch"; }).join(", ") : "—"}</td>
                      <td>
                        {p.serials.length ? (
                          <span className="flex flex-wrap gap-1.5">
                            {p.serials.map((c) => (
                              <SerialLink key={c.id} serial={c} />
                            ))}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </SimpleTable>
          )}
        </Card>

        <Card>
          <CardHeader title="History" subtitle="Every step, move and hand-off, oldest first." />
          {timeline.length === 0 ? (
            <p className="text-[12.5px] text-text-tertiary">No history yet.</p>
          ) : (
            <ol className="flex flex-col">
              {timeline.map((e) => {
                const other = e.otherSerialId ? serials.find((s) => s.id === e.otherSerialId) : undefined;
                return (
                  <li key={e.id} className="grid grid-cols-[150px_1fr] gap-3 border-b border-border py-2 text-[13px] last:border-b-0 max-sm:grid-cols-1 max-sm:gap-0.5">
                    <span className="tabular text-text-secondary">{formatDateTime(e.occurredAt)}</span>
                    <span>
                      <span className={e.kind === "note" ? "whitespace-pre-wrap text-text" : "text-text"}>{e.text}</span>
                      {other && (
                        <>
                          {" · "}
                          <SerialLink serial={other} />
                        </>
                      )}
                      {e.createdByName && <span className="text-text-tertiary"> · {e.createdByName}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {canWrite(user) && (
            <div className="mt-3 flex flex-col gap-2">
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to this unit's history" aria-label="Note" className="min-h-[60px]" />
              <div>
                <Button size="sm" loading={saving} disabled={!note.trim()} onClick={() => void saveNote()}>
                  Add note
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}

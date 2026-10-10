"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Tags, X } from "lucide-react";
import type { Item, Lot } from "@/lib/types";
import { useCollection, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { Badge, Banner, Button, Drawer, EmptyState, IconButton, Modal, Page, SearchField, Select, SimpleTable, Table, TextField, useToast, type Column } from "@/components/ui";
import { useRanchMode } from "./useRanchMode";

const WEIGHT_UNITS = new Set(["lb", "oz", "kg", "g"]);

/** The Lot # the counter knows an animal by: "1980 - 31F - PURE". */
export function animalLabel(number: string, tag: string, genetics: string): string {
  return [number.trim(), tag.trim(), genetics.trim()].filter(Boolean).join(" - ");
}

const GENETICS = [
  { value: "PURE", label: "Fullblood (PURE)" },
  { value: "F1", label: "F1" },
  { value: "F2", label: "F2" },
  { value: "F3", label: "F3" },
  { value: "", label: "Not recorded" },
];

function ReceiveAnimalModal({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [number, setNumber] = useState("");
  const [tag, setTag] = useState("");
  const [genetics, setGenetics] = useState("PURE");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [pounds, setPounds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = number.trim() ? animalLabel(number, tag, genetics) : "";
  // Cuts sold by weight, the ones the counter sells first.
  const cuts = useMemo(() => items.filter((i) => i.status === "active" && WEIGHT_UNITS.has(i.unit)).sort((a, b) => Number(!!b.externalIds?.square) - Number(!!a.externalIds?.square) || a.name.localeCompare(b.name)), [items]);
  const q = query.trim().toLowerCase();
  const shown = q ? cuts.filter((c) => c.name.toLowerCase().includes(q) || pounds[c.id]) : cuts;
  const entered = Object.entries(pounds).map(([itemId, v]) => ({ itemId, qty: Number(v) })).filter((c) => c.qty > 0);
  const total = Math.round(entered.reduce((a, c) => a + c.qty, 0) * 1000) / 1000;

  const submit = async () => {
    setError(null);
    if (!number.trim()) return setError("Enter the animal number.");
    if (entered.length === 0) return setError("Enter the pounds of at least one cut.");
    setBusy(true);
    try {
      const r = await api<{ summary: string; problems: string[] }>("/api/ranch/animals", { label, receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(), cuts: entered });
      toast(`Animal ${label} received: ${r.summary}`, "success");
      if (r.problems.length) toast(r.problems[0]!);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not receive the animal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Receive an animal"
      subtitle="Pounds of each cut back from processing. Each cut becomes a lot here and a Lot # in Square, ready for the counter."
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-text-secondary tabular-nums">{entered.length ? `${formatQty(total, "lb")} across ${entered.length} cut${entered.length === 1 ? "" : "s"}` : "No cuts yet"}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Receive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Banner tone="critical">{error}</Banner>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <TextField label="Animal #" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1980" />
          <TextField label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="31F" />
          <Select label="Genetics" options={GENETICS} value={genetics} onChange={(e) => setGenetics(e.target.value)} />
          <TextField label="Received" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </div>
        <p className="text-[12.5px] text-text-secondary">
          Lot # in Square: <span className="font-medium text-text">{label || "–"}</span>
        </p>
        <div className="flex flex-col gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Find a cut" />
          <div className="max-h-[46vh] overflow-y-auto rounded-[var(--radius)] border border-border">
            {shown.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{c.name}</div>
                  <div className="text-[11.5px] text-text-tertiary">{formatQty(c.onHand, c.unit)} on hand{c.externalIds?.square ? "" : " · not in Square"}</div>
                </div>
                <div className="w-32 shrink-0">
                  <TextField aria-label={`Pounds of ${c.name}`} inputMode="decimal" value={pounds[c.id] ?? ""} onChange={(e) => setPounds((p) => ({ ...p, [c.id]: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="0" suffix={c.unit} />
                </div>
              </div>
            ))}
            {shown.length === 0 && <p className="px-3 py-4 text-[13px] text-text-secondary">No cuts match.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** One lot's pounds in the animal drawer, recountable while cumulusOS keeps the counts. */
function LotPounds({ lot, unit, editable }: { lot: Lot; unit: string; editable: boolean }) {
  const api = useApi();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(lot.qtyRemaining));
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span className={`tabular-nums ${lot.qtyRemaining <= 0 ? "text-text-tertiary" : ""}`}>{formatQty(lot.qtyRemaining, unit)}</span>
        {editable && (
          <IconButton
            size="sm"
            variant="plain"
            icon={<Pencil />}
            aria-label="Recount"
            title="Recount"
            onClick={() => {
              setValue(String(lot.qtyRemaining));
              setEditing(true);
            }}
          />
        )}
      </span>
    );
  }
  const save = async () => {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty < 0) return toast("Enter the pounds counted.", "critical");
    setBusy(true);
    try {
      const r = await api<{ summary: string; problems: string[] }>("/api/ranch/lots/count", { lotId: lot.id, qty });
      toast(r.summary === "unchanged" ? "No change" : `Recounted: ${r.summary}`, "success");
      if (r.problems.length) toast(r.problems[0]!);
      setEditing(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Recount failed", "critical");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className="w-24">
        <TextField aria-label="Pounds counted" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} suffix={unit} autoFocus onKeyDown={(e) => e.key === "Enter" && void save()} />
      </span>
      <IconButton size="sm" variant="plain" icon={<Check />} aria-label="Save count" onClick={() => void save()} disabled={busy} />
      <IconButton size="sm" variant="plain" icon={<X />} aria-label="Cancel" onClick={() => setEditing(false)} disabled={busy} />
    </span>
  );
}

/** One animal (a Square "Lot #" value) across every cut it was broken into. */
interface Animal {
  key: string;
  label: string;
  /** Animal number(s) or tag, e.g. "1975" or "1846, 1847, …". */
  number: string;
  tag?: string;
  genetics?: string;
  pounds: number;
  value: number;
  cutsInStock: number;
  oldest: string;
  lots: Array<{ lot: Lot; item: Item | undefined }>;
}

/** "1975 - 27F - PURE" → number 1975, tag 27F, genetics PURE. */
export function parseAnimalLabel(label: string): { number: string; tag?: string; genetics?: string } {
  const parts = label.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { number: label };
  const last = parts[parts.length - 1]!;
  const genetics = /^(pure|f\d|fullblood|purebred|cross)/i.test(last) && parts.length > 1 ? last.toUpperCase() : undefined;
  const middle = parts.slice(1, genetics ? -1 : undefined).join(" - ");
  return { number: parts[0]!, tag: middle ? middle.replace(/^#/, "") : undefined, genetics };
}

export function AnimalsView() {
  const lots = useCollection("lots");
  const items = useCollection("items");
  const settings = useSettings();
  const user = useCurrentUser();
  const { mode } = useRanchMode();
  const keepsCounts = mode === "cumulus" && canWrite(user);
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const currency = settings.currency || "USD";

  const animals = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const groups = new Map<string, Animal>();
    for (const lot of lots) {
      const label = lot.supplierLot?.trim();
      // Square names a variation without options "Regular": an old way of selling the cut, not an animal.
      if (!label || label.toLowerCase() === "regular") continue;
      const item = byId.get(lot.itemId);
      if (lot.externalIds?.square === undefined && item?.externalIds?.square === undefined) continue;
      const key = label.toLowerCase();
      const a = groups.get(key) ?? { key, label, ...parseAnimalLabel(label), pounds: 0, value: 0, cutsInStock: 0, oldest: lot.receivedAt, lots: [] };
      a.lots.push({ lot, item });
      if (lot.qtyRemaining > 0) {
        a.pounds += lot.qtyRemaining;
        a.value += lot.qtyRemaining * (item?.price ?? 0);
        a.cutsInStock++;
      }
      if (lot.receivedAt < a.oldest) a.oldest = lot.receivedAt;
      groups.set(key, a);
    }
    return Array.from(groups.values()).map((a) => ({ ...a, pounds: Math.round(a.pounds * 1000) / 1000 }));
  }, [lots, items]);

  // The drawer follows the live lots, so a recount shows straight away.
  const open = openKey ? (animals.find((a) => a.key === openKey) ?? null) : null;
  const q = query.trim().toLowerCase();
  const rows = q ? animals.filter((a) => a.label.toLowerCase().includes(q) || a.lots.some((l) => l.item?.name.toLowerCase().includes(q))) : animals;
  const totalLb = animals.reduce((s, a) => s + a.pounds, 0);

  const columns: Column<Animal>[] = [
    {
      key: "animal",
      header: "Animal",
      render: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.number}</div>
          {a.tag && <div className="truncate text-[12px] text-text-tertiary">Tag {a.tag}</div>}
        </div>
      ),
      sortValue: (a) => a.number,
      minWidth: 160,
      flex: true,
    },
    { key: "genetics", header: "Genetics", render: (a) => (a.genetics ? <Badge tone={a.genetics === "PURE" ? "success" : "info"}>{a.genetics === "PURE" ? "Fullblood" : a.genetics}</Badge> : <span className="text-text-tertiary">–</span>), sortValue: (a) => a.genetics ?? "", minWidth: 110 },
    { key: "pounds", header: "On hand", align: "right", render: (a) => <span className="tabular-nums">{formatQty(a.pounds, "lb")}</span>, sortValue: (a) => a.pounds, minWidth: 100 },
    { key: "cuts", header: "Cuts in stock", align: "right", render: (a) => <span className="tabular-nums">{a.cutsInStock}</span>, sortValue: (a) => a.cutsInStock, minWidth: 100, priority: 2 },
    { key: "value", header: "Counter value", align: "right", render: (a) => <span className="tabular-nums">{formatMoney(a.value, currency)}</span>, sortValue: (a) => a.value, minWidth: 120, priority: 1 },
    { key: "oldest", header: "In since", render: (a) => formatDate(a.oldest), sortValue: (a) => a.oldest, minWidth: 110, priority: 1 },
  ];

  return (
    <Page
      title="Animals"
      subtitle={`Every animal's cuts, sold oldest first. ${formatQty(totalLb, "lb")} across ${animals.length} animal${animals.length === 1 ? "" : "s"}.${mode === "square" ? " Counts come from Square." : ""}`}
      primaryAction={
        keepsCounts ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setReceiving(true)}>
            Receive an animal
          </Button>
        ) : undefined
      }
    >
      {receiving && <ReceiveAnimalModal items={items} onClose={() => setReceiving(false)} />}
      <Table
        rows={rows}
        columns={columns}
        rowKey={(a) => a.key}
        onRowClick={(a) => setOpenKey(a.key)}
        fit
        layoutKey="ranch-animals"
        defaultSort={{ key: "oldest", dir: "asc" }}
        toolbar={<SearchField value={query} onChange={setQuery} placeholder="Search animals or cuts" />}
        emptyState={<EmptyState icon={<Tags />} title="No animals yet" description={mode === "cumulus" ? "Receive an animal with the pounds of each cut; it appears in Square as a Lot # on each cut." : "Connect Square under Integrations and press Sync now on Square & store. Each Lot # in Square becomes an animal here, with its cuts and pounds."} />}
      />
      <Drawer open={!!open} onClose={() => setOpenKey(null)} title={open ? `Animal ${open.number}` : ""} subtitle={open ? [open.tag ? `Tag ${open.tag}` : "", open.genetics ?? "", formatQty(open.pounds, "lb")].filter(Boolean).join(" · ") : undefined} width={560}>
        {open && (
          <SimpleTable>
            <thead>
              <tr>
                <th>Cut</th>
                <th>Lot</th>
                <th className="text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {[...open.lots]
                .sort((a, b) => b.lot.qtyRemaining - a.lot.qtyRemaining)
                .map(({ lot, item }) => (
                  <tr key={lot.id}>
                    <td>{item?.name ?? "Removed item"}</td>
                    <td className="whitespace-nowrap text-text-secondary">{lot.number ?? lot.id.slice(-6)}</td>
                    <td className="whitespace-nowrap text-right">
                      <LotPounds lot={lot} unit={item?.unit ?? "lb"} editable={keepsCounts} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </SimpleTable>
        )}
      </Drawer>
    </Page>
  );
}

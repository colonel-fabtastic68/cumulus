"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { CycleCount, CycleCountScope } from "@/lib/types";
import { binsAt, buildCountLines, startCycleCount, suggestCountItems } from "@/lib/cycleCounts";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { useCollection, useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { pluralize } from "@/lib/format";
import { Badge, Button, Checkbox, FormGrid, Modal, Segmented, Select, TextArea, TextField, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted?: (count: CycleCount) => void;
}

export function NewCountModal(props: Props) {
  if (!props.open) return null;
  return <NewCountForm {...props} />;
}

type Kind = CycleCountScope["kind"] | "suggested";

function NewCountForm({ open, onClose, onStarted }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const movements = useCollection("movements");
  const counts = useCollection("cycleCounts");
  const locations = useLocations();
  const home = useDefaultLocation();
  const { open: openAgent } = useAgent();
  const [locationId, setLocationId] = useState(home.id);
  const [kind, setKind] = useState<Kind>("bins");
  const [bins, setBins] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [blind, setBlind] = useState(true);
  const [limit, setLimit] = useState("25");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const binList = useMemo(() => binsAt(items, locationId, home.id), [items, locationId, home.id]);
  const categories = useMemo(() => Array.from(new Set(items.filter((i) => i.status === "active" && i.category).map((i) => i.category!))).sort(), [items]);
  const suggestions = useMemo(() => (kind === "suggested" ? suggestCountItems(items, movements, locationId, home.id, counts, { limit: Math.max(1, Number(limit) || 25) }) : []), [kind, items, movements, locationId, home.id, counts, limit]);
  const scope = useMemo<CycleCountScope>(() => {
    if (kind === "bins") return { kind: "bins", bins: Array.from(bins) };
    if (kind === "category") return { kind: "category", category };
    if (kind === "suggested") return { kind: "items", itemIds: suggestions.map((s) => s.itemId) };
    if (kind === "items") return { kind: "items", itemIds: [] };
    return { kind: "location" };
  }, [kind, bins, category, suggestions]);
  const preview = useMemo(() => buildCountLines(items, locationId, home.id, scope), [items, locationId, home.id, scope]);

  const toggleBin = (b: string) =>
    setBins((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const submit = async () => {
    if (preview.length === 0) return setError("Nothing to count with that scope. Pick bins or a category that have stock.");
    setBusy(true);
    setError(null);
    try {
      const count = await startCycleCount(store, user, { locationId, scope, name, note, blind });
      toast(`Started ${count.number} with ${pluralize(count.lines.length, "line")}`, "success");
      onStarted?.(count);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  const locName = locations.find((l) => l.id === locationId)?.name ?? home.name;
  const askStrato = () => {
    onClose();
    openAgent(`Propose a cycle count for ${locName}: which bins or items should we count first and why, with the quantity you expect on the shelf for each. Then start the count for me.`, { send: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New cycle count"
      subtitle="Pick what to count. Expected quantities are frozen now; when you complete the count, every difference becomes a count movement."
      footer={
        <>
          <Button variant="plain" icon={<Sparkles />} onClick={askStrato} className="mr-auto">
            Let Strato propose
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={preview.length === 0}>
            Start count ({preview.length})
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={2}>
          <Select label="Location" value={locationId} onChange={(e) => { setLocationId(e.target.value); setBins(new Set()); }} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          <TextField label="Name" hint="(optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aisle A, week 40" />
        </FormGrid>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text">Scope</div>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "bins", label: "Bins" },
              { value: "category", label: "Category" },
              { value: "suggested", label: "Suggested" },
              { value: "location", label: "Whole location" },
            ]}
          />
        </div>
        {kind === "bins" && (
          <div>
            {binList.length === 0 ? (
              <p className="text-[12.5px] text-text-tertiary">No bins are recorded at {locName} yet. Set bins on items (item page, Locations tab), or count by category instead.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {binList.map((b) => (
                  <button key={b.bin} type="button" onClick={() => toggleBin(b.bin)} className={`rounded-full border px-2.5 py-1 text-[12px] ${bins.has(b.bin) ? "border-text bg-text text-surface" : "border-border bg-surface text-text hover:bg-surface-subdued"}`} aria-pressed={bins.has(b.bin)}>
                    <span className="font-mono">{b.bin}</span> <span className={bins.has(b.bin) ? "opacity-70" : "text-text-tertiary"}>· {b.items}</span>
                  </button>
                ))}
                <button type="button" className="px-2 text-[12px] text-accent hover:underline" onClick={() => setBins(new Set(bins.size === binList.length ? [] : binList.map((b) => b.bin)))}>
                  {bins.size === binList.length ? "Clear" : "All bins"}
                </button>
              </div>
            )}
          </div>
        )}
        {kind === "category" && <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "Choose a category" }, ...categories.map((c) => ({ value: c, label: c }))]} />}
        {kind === "suggested" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-3">
              <TextField label="How many items" type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(e.target.value)} containerClassName="w-32" />
              <p className="pb-2 text-[12.5px] text-text-secondary">Items never counted, busy since their last count, low or negative on paper, or holding the most value come first.</p>
            </div>
            {suggestions.length === 0 ? (
              <p className="text-[12.5px] text-text-tertiary">Nothing stands out at {locName}.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-[var(--radius)] border border-border text-[12.5px]">
                {suggestions.map((s) => (
                  <li key={s.itemId} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-16 shrink-0 font-mono text-text-secondary">{s.bin ?? "—"}</span>
                    <span className="font-mono">{s.sku}</span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{s.name}</span>
                    <span className="tabular">{s.expected}</span>
                    <Badge tone={s.priority >= 60 ? "warning" : "default"}>{s.reasons[0]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Checkbox label="Blind count" help="Counters do not see the expected quantity while counting. Recommended: it stops people from writing down what the screen says." checked={blind} onChange={setBlind} />
        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <p className="text-[12.5px] text-text-secondary">
          {preview.length ? `${pluralize(preview.length, "line")} at ${locName}` : "No lines yet"}
        </p>
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}

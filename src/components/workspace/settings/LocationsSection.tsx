"use client";

import { useState } from "react";
import { Check, MapPin, Plus } from "lucide-react";
import type { Location } from "@/lib/types";
import { Badge, Button, IconButton, Select, TextField, useToast } from "@/components/ui";
import { DEFAULT_LOCATION_ID } from "@/lib/inventory";
import { LOCATION_KINDS, locationKindLabel, useAllLocations } from "@/lib/locations";
import { useStore } from "@/lib/store/provider";
import { newId, nowIso } from "@/lib/utils";

/** Factor 29: the places stock can sit. Bins are set per item inside a location. */
export function LocationsSection({ readOnly }: { readOnly: boolean }) {
  const store = useStore();
  const toast = useToast();
  const locations = useAllLocations();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Location["kind"]>("warehouse");
  const [busy, setBusy] = useState<string | null>(null);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy("add");
    try {
      const isFirst = locations.length === 0;
      const loc: Location = { id: isFirst ? DEFAULT_LOCATION_ID : newId("loc"), name: trimmed, kind, code: code.trim() || undefined, isDefault: isFirst || undefined, active: true, createdAt: nowIso() };
      await store.put("locations", loc);
      setName("");
      setCode("");
      toast(`Added ${trimmed}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add the location", "critical");
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async (loc: Location) => {
    setBusy(loc.id);
    try {
      const ops = locations.filter((l) => l.isDefault && l.id !== loc.id).map((l) => ({ op: "patch" as const, collection: "locations" as const, id: l.id, patch: { isDefault: false } }));
      await store.batch([...ops, { op: "patch", collection: "locations", id: loc.id, patch: { isDefault: true, active: true } }]);
      toast(`${loc.name} is now the default location`, "success");
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (loc: Location) => {
    if (loc.isDefault && loc.active) return toast("Pick another default location first", "critical");
    setBusy(loc.id);
    try {
      await store.patch("locations", loc.id, { active: !loc.active });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {locations.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No locations yet. The first one you add becomes the default, and everything already on hand counts as sitting there. Bins (aisle, rack, shelf) are set per item on its Locations tab.</p>
      ) : (
        <ul className="card divide-y divide-border p-0">
          {locations.map((loc) => (
            <li key={loc.id} className="flex items-center gap-3 px-4 py-2.5">
              <MapPin className="h-4 w-4 shrink-0 text-icon" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text">
                  {loc.name}
                  {loc.code && <span className="font-mono text-[11.5px] text-text-tertiary">{loc.code}</span>}
                  {loc.isDefault && <Badge tone="success">Default</Badge>}
                  {!loc.active && <Badge>Inactive</Badge>}
                </div>
                <div className="text-[12px] text-text-secondary">{locationKindLabel(loc.kind)}</div>
              </div>
              {!readOnly && (
                <>
                  {!loc.isDefault && (
                    <Button size="sm" variant="plain" icon={<Check />} loading={busy === loc.id} onClick={() => void makeDefault(loc)}>
                      Make default
                    </Button>
                  )}
                  <Button size="sm" variant="plain" loading={busy === loc.id} onClick={() => void toggleActive(loc)}>
                    {loc.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_170px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <TextField label="New location" value={name} onChange={(e) => setName(e.target.value)} placeholder="Warehouse B, Truck 4, Trailer 1" />
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-B" />
          <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Location["kind"])} options={LOCATION_KINDS} />
          <IconButton type="submit" variant="primary" aria-label="Add location" icon={<Plus />} loading={busy === "add"} disabled={!name.trim()} />
        </form>
      )}
    </div>
  );
}

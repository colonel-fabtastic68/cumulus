"use client";

import { useMemo } from "react";
import type { Item, Location } from "@/lib/types";
import { defaultLocation, qtyAt } from "@/lib/inventory";
import { useCollection } from "@/lib/store/provider";

/** Active locations, default first, then by name. */
export function useLocations(): Location[] {
  const rows = useCollection("locations");
  return useMemo(() => [...rows].filter((l) => l.active).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name)), [rows]);
}

/** Every location including inactive ones (for history and settings). */
export function useAllLocations(): Location[] {
  const rows = useCollection("locations");
  return useMemo(() => [...rows].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name)), [rows]);
}

/** The location stock lands in when none is chosen. Exists even before the first movement creates it. */
export function useDefaultLocation(): Location {
  const rows = useCollection("locations");
  return useMemo(() => defaultLocation(rows).location, [rows]);
}

export function useLocationName(): (id: string | undefined) => string {
  const rows = useCollection("locations");
  const home = useDefaultLocation();
  return useMemo(() => {
    const byId = new Map(rows.map((l) => [l.id, l.name]));
    return (id: string | undefined) => (id ? (byId.get(id) ?? (id === home.id ? home.name : id)) : home.name);
  }, [rows, home]);
}

/** Quantity of an item at a location, treating pre-location items as living in the default location. */
export function itemQtyAt(item: Item, locationId: string, homeId: string): number {
  return qtyAt(item, locationId, homeId);
}

/** Bin for an item at a location, falling back to the legacy single location field. */
export function itemBinAt(item: Item, locationId: string, homeId: string): string | undefined {
  if (item.stock) return item.stock[locationId]?.bin;
  return locationId === homeId ? item.location : undefined;
}

export const LOCATION_KINDS: Array<{ value: Location["kind"]; label: string }> = [
  { value: "warehouse", label: "Warehouse" },
  { value: "store", label: "Store / counter" },
  { value: "vehicle", label: "Truck / van" },
  { value: "trailer", label: "Trailer / container" },
  { value: "customer", label: "Customer site" },
  { value: "other", label: "Other" },
];

export function locationKindLabel(kind: Location["kind"]): string {
  return LOCATION_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

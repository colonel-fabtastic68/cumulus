import { activityOp, InventoryError, type Actor } from "@/lib/inventory";
import { serialEvent } from "@/lib/serials";
import type { Store } from "@/lib/store/types";

/**
 * Writes on a serial that are not part of making or shipping it (feature `serials`).
 * Kept apart from src/lib/serials.ts so that file stays free of the ledger.
 */

/** Adds a dated note to a serial's history, e.g. "Customer reported a cracked mount". */
export async function addSerialNote(store: Store, actor: Actor, serialId: string, text: string, occurredAt?: string): Promise<void> {
  const note = text.trim();
  if (!note) throw new InventoryError("Write the note first");
  const serial = await store.get("serials", serialId);
  if (!serial) throw new InventoryError("Serial number not found");
  await store.batch([
    { op: "put", collection: "serialEvents", doc: serialEvent(actor, serial.id, "note", note, occurredAt ? { occurredAt } : {}) },
    activityOp(actor, "serial.note", `${actor.name} added a note to ${serial.number}`, { entityType: "serial", entityId: serial.id }),
  ]);
}

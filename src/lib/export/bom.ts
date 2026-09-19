import type { Item } from "@/lib/types";
import { buildableQty, explodeBom, rolledUpCost } from "@/lib/inventory";
import { round } from "@/lib/utils";
import type { Table } from "./formats";

/**
 * One assembly's bill of materials as tables: the direct components grouped
 * by category with subtotals, then every part at every level, then a summary.
 */

const typeLabel = (i: Item) => (i.type === "assembly" ? "BOM" : "Part");
const groupOf = (i: Item) => i.category?.trim() || "Uncategorized";

export function bomTables(assembly: Item, items: Item[]): { components: Table; exploded: Table; summary: Table } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const direct = assembly.bom.map((l) => ({ line: l, item: byId.get(l.itemId) })).filter((x): x is { line: (typeof assembly.bom)[number]; item: Item } => !!x.item);
  const groups = new Map<string, typeof direct>();
  for (const d of direct) groups.set(groupOf(d.item), [...(groups.get(groupOf(d.item)) ?? []), d]);

  const rows: Table["rows"] = [];
  let total = 0;
  for (const group of Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))) {
    let subtotal = 0;
    for (const { line, item } of groups.get(group)!.sort((a, b) => a.item.sku.localeCompare(b.item.sku))) {
      const withWaste = round(line.qty * (1 + (line.wastePct ?? 0) / 100), 4);
      const lineCost = round(withWaste * item.unitCost);
      subtotal += lineCost;
      rows.push([group, item.sku, item.name, typeLabel(item), line.qty, item.unit, line.wastePct ?? "", withWaste, item.unitCost, lineCost, item.onHand, item.onHand > 0 && withWaste > 0 ? Math.floor(item.onHand / withWaste) : 0, item.supplierId ? "" : ""]);
    }
    rows.push([group, "", `Subtotal · ${group}`, "", "", "", "", "", "", round(subtotal), "", "", ""]);
    total += subtotal;
  }
  rows.push(["", "", "Total per unit", "", "", "", "", "", "", round(total), "", "", ""]);
  const components: Table = {
    id: `bom-${assembly.sku.toLowerCase()}`,
    label: `BOM · ${assembly.sku}`,
    headers: ["Group", "Component SKU", "Component", "Type", "Qty per", "Unit", "Waste %", "Qty incl. waste", "Unit cost", "Line cost", "On hand", "Units buildable from stock", ""],
    rows,
  };
  components.headers = components.headers.slice(0, 12);
  components.rows = components.rows.map((r) => r.slice(0, 12));

  const req = explodeBom(items, assembly, 1, { consumeSubassemblies: false });
  const exploded: Table = {
    id: `bom-${assembly.sku.toLowerCase()}-all-parts`,
    label: `All parts · ${assembly.sku}`,
    headers: ["Group", "Level", "SKU", "Item", "Type", "Qty per unit", "Unit", "Unit cost", "Line cost", "On hand", "Short for one unit"],
    rows: [...req]
      .sort((a, b) => groupOf(a.item).localeCompare(groupOf(b.item)) || a.depth - b.depth || a.item.sku.localeCompare(b.item.sku))
      .map((r) => [groupOf(r.item), r.depth + 1, r.item.sku, r.item.name, typeLabel(r.item), round(r.required, 4), r.item.unit, r.item.unitCost, round(r.required * r.item.unitCost), r.available, r.shortage > 0 ? round(r.shortage, 4) : ""]),
  };

  const summary: Table = {
    id: `bom-${assembly.sku.toLowerCase()}-summary`,
    label: `Summary · ${assembly.sku}`,
    headers: ["Field", "Value"],
    rows: [
      ["Assembly SKU", assembly.sku],
      ["Name", assembly.name],
      ["Category", assembly.category ?? ""],
      ["Direct components", direct.length],
      ["Parts at all levels", req.length],
      ["Rolled-up cost per unit", round(rolledUpCost(items, assembly))],
      ["Standard cost on the item", assembly.unitCost],
      ["List price", assembly.price],
      ["On hand", assembly.onHand],
      ["Buildable now (from stock)", buildableQty(items, assembly)],
      ["Exported", new Date().toISOString()],
    ],
  };
  return { components, exploded, summary };
}

import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, Database, Hammer, ListTree, PackageSearch, RefreshCw, Tags, Timer } from "lucide-react";

export interface QuickTask {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Sent to the agent verbatim. */
  prompt: string;
}

export const QUICK_TASKS: QuickTask[] = [
  {
    id: "reorder",
    title: "Reorder plan",
    description: "Everything below minimum, grouped by supplier with quantities and lead times.",
    icon: RefreshCw,
    prompt:
      "Build a reorder plan. List every active item below its minimum quantity, grouped by supplier. For each item show on hand, min, max, the reorder quantity that brings it to max (or twice the min when there is no max), unit cost and extended cost. Flag anything with a lead time over 14 days and give a total per supplier.",
  },
  {
    id: "cycle-count",
    title: "Cycle count helper",
    description: "Which items to count first, ranked by value and recent movement.",
    icon: ClipboardCheck,
    prompt:
      "Help me plan a cycle count. Rank the items we should count first based on inventory value (on hand times unit cost) and recent movement volume, and list the top 20 with SKU, location, on hand and the reason each made the list. Group the list by location so it can be walked in one pass.",
  },
  {
    id: "price-review",
    title: "Price review",
    description: "Items whose margin has slipped below a threshold, with suggested prices.",
    icon: Tags,
    prompt:
      "Run a price review. For every active item with a list price, compute the margin percentage against unit cost (use the rolled-up BOM cost for assemblies). List everything with a margin below 40%, sorted by margin ascending, with SKU, cost, price, margin and a suggested price that restores a 40% margin. Do not change any prices until I approve.",
  },
  {
    id: "dead-stock",
    title: "Dead stock sweep",
    description: "Active parts with no consumption and no live BOM usage.",
    icon: PackageSearch,
    prompt:
      "Run a dead stock sweep. Find active items with no consumption in the last 120 days that are not used in any active BOM. Show SKU, on hand, inventory value and last movement date, sorted by value descending. Propose which ones to deactivate, discount or write off.",
  },
  {
    id: "shelf-life",
    title: "Shelf-life review",
    description: "Oldest batches on the shelf and what to do about them.",
    icon: Timer,
    prompt:
      "Run a shelf-life review. Show the batches that have been on the shelf the longest with remaining quantity, days on shelf and value at cost. Highlight anything past its expiry or older than 180 days and suggest a sale price for each that keeps at least a 30% margin.",
  },
  {
    id: "build-plan",
    title: "Build plan for open orders",
    description: "What to build so every open order can ship, with component shortages.",
    icon: Hammer,
    prompt:
      "Create a build plan for every open sales order. Total the demand per finished good across all open orders, compare it with on hand, and tell me how many of each assembly to build so every order can ship. Explode the BOMs for those builds and list any component shortages with the quantity short and the supplier.",
  },
  {
    id: "bom-audit",
    title: "BOM audit",
    description: "Inactive or superseded components, missing costs, empty BOMs.",
    icon: ListTree,
    prompt:
      "Audit every assembly's bill of materials. Flag components that are inactive or superseded (and what supersedes them), components with a zero or missing unit cost, and assemblies with an empty BOM. For each problem give the assembly SKU, the component SKU and the recommended fix.",
  },
  {
    id: "data-quality",
    title: "Data quality check",
    description: "Items missing cost, price, min/max, supplier or category.",
    icon: Database,
    prompt:
      "Run a data quality check on the item master. List active items missing a unit cost, a list price, a min or max quantity, a supplier (parts only) or a category. Group the results by problem, show the SKUs, and propose sensible values where you can infer them from similar items. Do not apply anything until I approve.",
  },
];

import type { OnboardingAnswers } from "@/lib/types";

/**
 * The guided setup after a workspace is created: what the business uses
 * today, what it wants from cumulusOS, what it tracks, then the import hub
 * shaped by those answers. The option lists live here so the walkthrough,
 * the import hub and Strato's prompts agree on the vocabulary.
 */

export interface SourceOption {
  id: string;
  label: string;
  /** One line under the label on the choice card. */
  hint: string;
  /** Catalog integration id when the source can also connect live. */
  integrationId?: "shopify" | "woocommerce" | "quickbooks" | "square" | "clover";
  /** How to get the data out of that system and into cumulusOS. */
  export?: { steps: string[]; formats: string; note?: string };
}

export const SOURCE_OPTIONS: SourceOption[] = [
  {
    id: "spreadsheet",
    label: "Spreadsheets",
    hint: "Excel, Google Sheets or Numbers",
    export: {
      steps: ["Open the sheet that lists your items with a header row (SKU, name, quantity, cost…)", "Google Sheets: File → Download → Microsoft Excel (.xlsx). Numbers: File → Export To → Excel", "Drop the file below, or copy the cells and paste them"],
      formats: ".xlsx, .csv, .tsv or pasted cells",
      note: "Column names are matched automatically; anything unusual can be mapped by hand or by Strato.",
    },
  },
  {
    id: "quickbooks",
    label: "QuickBooks",
    hint: "Products and Services list",
    integrationId: "quickbooks",
    export: {
      steps: ["In QuickBooks Online open Sales → Products and services", "Use the export icon above the list to download the Excel file", "Drop that file below; SKU, quantity on hand, purchase cost and reorder point are recognized"],
      formats: ".xlsx or .csv",
    },
  },
  {
    id: "square",
    label: "Square",
    hint: "Item library and counts",
    integrationId: "square",
    export: {
      steps: ["In Square Dashboard open Items & orders → Items", "Choose Actions → Export library and download the CSV", "Drop the CSV below; Current Quantity becomes the on-hand count"],
      formats: ".csv",
    },
  },
  {
    id: "shopify",
    label: "Shopify",
    hint: "Products export",
    integrationId: "shopify",
    export: {
      steps: ["In Shopify admin open Products and click Export", "Choose All products and Plain CSV file", "Drop the CSV below; variants, prices, costs and barcodes come through"],
      formats: ".csv",
    },
  },
  {
    id: "woocommerce",
    label: "WooCommerce",
    hint: "Products export",
    integrationId: "woocommerce",
    export: {
      steps: ["In WordPress open Products and click Export", "Keep all columns selected and generate the CSV", "Drop the CSV below; SKU, stock, prices, categories and dimensions come through"],
      formats: ".csv",
    },
  },
  {
    id: "clover",
    label: "Clover",
    hint: "Inventory items",
    integrationId: "clover",
    export: {
      steps: ["In the Clover web dashboard open Inventory → Items", "Choose Export and download the spreadsheet", "Drop the file below; SKU, name, price, cost and quantity are recognized"],
      formats: ".xlsx or .csv",
    },
  },
  {
    id: "other-app",
    label: "Another app",
    hint: "Any system that can export a file",
    export: {
      steps: ["Find the export (often under Reports, Items or Settings → Data) and download the item list", "Any spreadsheet, CSV, XML or PDF works", "Drop the file below; Strato reads formats the mapper does not know"],
      formats: ".xlsx, .csv, .xml, .pdf, .txt",
    },
  },
  {
    id: "paper",
    label: "Paper or whiteboard",
    hint: "Notebooks, count sheets, printouts",
    export: {
      steps: ["Lay each sheet flat in good light", "Take a photo of every page from straight above, or scan them to a PDF", "Strato reads the names, codes and counts into a table you can check before importing"],
      formats: "photos (.jpg, .png, .heic) or .pdf",
    },
  },
  { id: "memory", label: "Nothing written down", hint: "It lives in people's heads", export: { steps: ["Start from a blank workspace and add items as you count them", "Or dictate a list into a note on your phone and paste it below; Strato turns a plain list into rows", "Quantities can be set later with a cycle count"], formats: "pasted text" } },
];

export const USAGE_OPTIONS: Array<{ id: NonNullable<OnboardingAnswers["usage"]>; label: string; hint: string }> = [
  { id: "light", label: "Light use", hint: "Know what is on the shelf, get a nudge when something runs low." },
  { id: "partial", label: "Replace or connect some tools", hint: "Keep the store or accounting app, let cumulusOS run stock, purchasing and counts alongside it." },
  { id: "full", label: "Run everything here", hint: "Inventory, BOMs, orders, suppliers, receiving and reports, with no other inventory app." },
];

export const ITEM_KIND_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: "finished-goods", label: "Finished products", hint: "Things you sell as they are" },
  { id: "parts", label: "Parts and components", hint: "Built into assemblies with a BOM" },
  { id: "raw-materials", label: "Raw materials", hint: "Bought by weight, length or volume" },
  { id: "retail", label: "Retail merchandise", hint: "Resold goods with barcodes and prices" },
  { id: "food", label: "Food and perishables", hint: "Batches with best-before dates" },
  { id: "supplies", label: "Supplies and consumables", hint: "Packaging, shop supplies, office stock" },
  { id: "equipment", label: "Equipment and tools", hint: "Serialized or checked in and out" },
  { id: "livestock", label: "Livestock or produce", hint: "Animals, lots, harvests" },
  { id: "other", label: "Something else", hint: "Tell us in a word or two" },
];

export function sourceOption(id: string): SourceOption | undefined {
  return SOURCE_OPTIONS.find((s) => s.id === id);
}

/** Labels for the answers, for summaries and Strato's prompts. */
export function describeAnswers(a: OnboardingAnswers | undefined): string {
  if (!a) return "";
  const parts: string[] = [];
  const sources = (a.sources ?? []).map((id) => (id === "other-app" && a.otherSource ? a.otherSource : (sourceOption(id)?.label ?? id)));
  if (sources.length) parts.push(`Inventory lived in: ${sources.join(", ")}`);
  const usage = USAGE_OPTIONS.find((u) => u.id === a.usage);
  if (usage) parts.push(`Wants: ${usage.label.toLowerCase()}`);
  const kinds = (a.itemKinds ?? []).map((id) => (id === "other" && a.otherKinds ? a.otherKinds : (ITEM_KIND_OPTIONS.find((k) => k.id === id)?.label ?? id)));
  if (kinds.length) parts.push(`Tracks: ${kinds.join(", ")}`);
  return parts.join(" · ");
}

/** The intake's integration picks (from the welcome screen) become the first answer's default. */
export function sourcesFromIntake(integrations: string[] | undefined): string[] {
  if (!integrations?.length) return [];
  return integrations.filter((id) => SOURCE_OPTIONS.some((s) => s.id === id));
}

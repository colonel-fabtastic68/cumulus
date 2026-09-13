"use client";

import { FileDown } from "lucide-react";
import type { Item } from "@/lib/types";
import { bomTables } from "@/lib/export/bom";
import { exportTables, type ExportFormat } from "@/lib/export/formats";
import { Button, Menu, useToast } from "@/components/ui";

/** Downloads one assembly's bill of materials: components grouped by category, every part at every level, and a summary. */
export function ExportBomMenu({ assembly, items, size = "sm", label = "Export BOM" }: { assembly: Item; items: Item[]; size?: "sm" | "md"; label?: string }) {
  const toast = useToast();
  const run = (format: ExportFormat, all: boolean) => {
    if (assembly.bom.length === 0) return toast(`${assembly.sku} has no components yet`, "critical");
    const t = bomTables(assembly, items);
    const res = exportTables(all ? [t.summary, t.components, t.exploded] : [t.components], format, `bom-${assembly.sku.toLowerCase()}`);
    if (res.note === "blocked") toast("Allow pop-ups to open the print view", "critical");
    else if (res.note === "print") toast("Print view opened. Choose Save as PDF in the dialog.", "success");
    else toast(`Exported the BOM for ${assembly.sku}`, "success");
  };
  return (
    <Menu
      align="right"
      trigger={
        <Button size={size} icon={<FileDown />}>
          {label}
        </Button>
      }
      items={[
        { label: "CSV · components grouped by category", onSelect: () => run("csv", false) },
        { label: "Excel · summary, components, all parts", onSelect: () => run("xlsx", true) },
        { label: "Print / PDF", onSelect: () => run("pdf", true) },
        { label: "Markdown", onSelect: () => run("md", true) },
      ]}
    />
  );
}

import { Badge, SimpleTable } from "@/components/ui";

const LINES = [
  { part: "TUBE-4130-1.625x.095", name: "4130 chromoly tube, 1.625 × .095", qty: "48 ft", lot: "Heat 7A2219", status: "picked" },
  { part: "BRKT-LCA-F", name: "Lower control arm bracket, front", qty: "4", lot: "Lot 0931", status: "picked" },
  { part: "ROD-END-3/4-16", name: "Rod end, 3/4-16 chromoly", qty: "8", lot: "Lot 0874", status: "short" },
  { part: "WLD-ER70S-6", name: "Filler wire ER70S-6, .035", qty: "2 lb", lot: "FIFO", status: "picked" },
  { part: "ASM-FLOOR-PAN", name: "Floor pan sub-assembly", qty: "1", lot: "Build 117", status: "built" },
] as const;

/** A build sheet for a chassis assembly, rendered from the app's components. Decorative. */
export function BuildSheet({ className }: { className?: string }) {
  return (
    <div className={`card overflow-hidden text-[13px] leading-5 ${className ?? ""}`} aria-hidden>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="leading-tight">
          <div className="font-semibold text-text">Build 118 · LC-4130 tube chassis</div>
          <div className="text-[11.5px] text-text-tertiary">BOM 3 levels deep · 1 of 2 for Rivera Racing</div>
        </div>
        <Badge tone="warning" className="ml-auto">
          1 short
        </Badge>
      </div>
      <SimpleTable>
        <thead>
          <tr>
            <th>Part</th>
            <th>Need</th>
            <th>Lot</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {LINES.map((l) => (
            <tr key={l.part}>
              <td>
                <div className="font-mono text-[11.5px] text-text">{l.part}</div>
                <div className="text-[12px] text-text-tertiary">{l.name}</div>
              </td>
              <td className="tabular">{l.qty}</td>
              <td className="text-text-secondary">{l.lot}</td>
              <td>
                <Badge tone={l.status === "picked" ? "success" : l.status === "built" ? "info" : "warning"}>{l.status === "picked" ? "Picked" : l.status === "built" ? "From stock" : "Short 2"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </SimpleTable>
      <div className="flex items-center gap-2 border-t border-border bg-surface-subdued px-4 py-2.5 text-[12px] text-text-secondary">
        <span className="h-2 w-2 rounded-full bg-accent" />
        Strato: rod ends are 2 short; a PO to Summit Fasteners is drafted and waiting for approval.
      </div>
    </div>
  );
}

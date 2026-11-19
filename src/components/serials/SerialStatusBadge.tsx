import Link from "next/link";
import type { Serial, SerialStatus } from "@/lib/types";
import { SERIAL_STATUS_LABEL } from "@/lib/serials";
import { Badge } from "@/components/ui";

const TONE: Record<SerialStatus, "default" | "info" | "success" | "warning" | "critical" | "attention"> = {
  planned: "default",
  in_production: "attention",
  in_stock: "success",
  installed: "info",
  shipped: "info",
  scrapped: "critical",
  voided: "default",
};

export function SerialStatusBadge({ status }: { status: SerialStatus }) {
  return <Badge tone={TONE[status]}>{SERIAL_STATUS_LABEL[status]}</Badge>;
}

export function serialHref(id: string): string {
  return `/serials/${encodeURIComponent(id)}`;
}

/** A serial number that opens its record. */
export function SerialLink({ serial, className }: { serial: Pick<Serial, "id" | "number">; className?: string }) {
  return (
    <Link href={serialHref(serial.id)} className={className ?? "font-mono text-[12.5px] font-medium text-accent hover:underline"}>
      {serial.number}
    </Link>
  );
}

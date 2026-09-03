"use client";

import { Boxes, Download, Plus } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";

export function DashboardEmpty({ onNewItem, canCreate }: { onNewItem: () => void; canCreate: boolean }) {
  return (
    <Card padded={false}>
      <EmptyState
        icon={<Boxes />}
        title="Your workspace is empty"
        description="Import a spreadsheet from your current system, or add your first item by hand. Stock levels, orders and reports will fill in from there."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" icon={<Download />} href="/import">
              Import a spreadsheet
            </Button>
            <Button icon={<Plus />} onClick={onNewItem} disabled={!canCreate}>
              New item
            </Button>
          </div>
        }
      />
    </Card>
  );
}

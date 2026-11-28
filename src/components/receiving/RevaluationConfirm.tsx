"use client";

import type { PendingRevaluation } from "@/lib/revaluation";
import { describeRevaluation } from "@/lib/revaluation";
import { formatMoney } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Button, Modal } from "@/components/ui";

/**
 * Feature `valuationAudit`: before a delivery changes standard cost, say what that does to the
 * stock already on the shelf and let the person choose. Revaluing posts a revaluation to the
 * ledger and Activity; keeping the old cost receives the delivery without touching standard cost.
 */
export function RevaluationConfirm({ revaluations, currency, busy, onRevalue, onKeepCost, onClose }: { revaluations: PendingRevaluation[] | null; currency: string; busy?: boolean; onRevalue: () => void; onKeepCost: () => void; onClose: () => void }) {
  if (!revaluations) return null;
  const total = round(sum(revaluations.map((r) => r.value)), 2);
  const one = revaluations.length === 1;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={one ? "Revalue the stock already on hand?" : `Revalue ${revaluations.length} items already on hand?`}
      subtitle="Updating standard cost changes the value of every unit on the shelf, not only this delivery."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onKeepCost} disabled={busy}>
            Keep the old cost
          </Button>
          <Button variant="primary" onClick={onRevalue} loading={busy}>
            Revalue and receive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <ul className="flex flex-col gap-1">
          {revaluations.map((r) => (
            <li key={r.item.id} className="tabular">
              {describeRevaluation(r, currency)}
            </li>
          ))}
        </ul>
        {!one && (
          <p className="text-text-secondary">
            Total change in inventory value: <span className="font-medium text-text tabular">{total >= 0 ? "+" : "−"}{formatMoney(Math.abs(total), currency)}</span>
          </p>
        )}
        <p className="text-[12.5px] text-text-secondary">Revaluing records the change in the item&apos;s stock history and in Activity, with your name and the amount. Keeping the old cost receives the delivery at its own price and leaves standard cost as it is.</p>
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingCart, Sparkles, Wand2 } from "lucide-react";
import type { Item, ReplenishmentRule } from "@/lib/types";
import { autoReplenish, replenish, replenishmentSummary, setReplenishmentRule, snoozeReplenishment, type ReplenishResult } from "@/lib/replenishment";
import { useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatQty, pluralize } from "@/lib/format";
import { Button, Modal, Page, useToast } from "@/components/ui";
import { BuildModal } from "@/components/inventory";
import { ReplenishmentStats, ReplenishmentTable, useReplenishmentPlan } from "@/components/replenishment";

export default function ReplenishmentPage() {
  const rows = useReplenishmentPlan();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const { open: openAgent, setPageContext } = useAgent();
  const summary = useMemo(() => replenishmentSummary(rows), [rows]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplenishResult | null>(null);
  const [build, setBuild] = useState<{ item: Item; qty: number } | null>(null);

  useEffect(() => {
    setPageContext({ page: "Replenishment", selectedSkus: rows.filter((r) => r.status === "order").slice(0, 20).map((r) => r.item.sku) });
  }, [setPageContext, rows]);

  const order = async (selections: Array<{ itemId: string; qty: number }>) => {
    if (!writable) return;
    setBusy(true);
    try {
      const res = await replenish(store, user, selections, { source: "replenishment" });
      setResult(res);
      const n = res.created.length + res.updated.length;
      toast(n ? `${pluralize(res.created.length, "order")} drafted${res.updated.length ? `, ${pluralize(res.updated.length, "draft")} extended` : ""}` : "Nothing was ordered", n ? "success" : "critical");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };
  const orderEverything = () => order(rows.filter((r) => r.status === "order" && r.route === "buy").map((r) => ({ itemId: r.item.id, qty: r.toOrder })));
  const runAuto = async () => {
    setBusy(true);
    try {
      const outcome = await autoReplenish(store, user);
      toast(`Automatic rules: ${outcome}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };
  const snooze = async (itemIds: string[], until: string | null) => {
    try {
      const n = await snoozeReplenishment(store, user, itemIds, until);
      toast(until ? `${pluralize(n, "item")} snoozed until ${until}` : `Snooze cleared on ${pluralize(n, "item")}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };
  const rule = async (itemId: string, patch: Partial<ReplenishmentRule>) => {
    try {
      await setReplenishmentRule(store, user, itemId, patch);
      toast(patch.auto === true ? "Automatic: a draft order is created when the forecast dips below min" : patch.auto === false ? "Back to manual" : "Rule saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };

  const toOrderBuy = rows.filter((r) => r.status === "order" && r.route === "buy" && r.supplier).length;

  return (
    <Page
      title="Replenishment"
      subtitle="What to order or build, from the forecast: on hand, plus what is already on order, minus what open orders will take"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<ShoppingCart />} onClick={() => void orderEverything()} loading={busy} disabled={toOrderBuy === 0}>
            Order everything{toOrderBuy ? ` (${toOrderBuy})` : ""}
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          {writable && summary.auto > 0 && (
            <Button icon={<Wand2 />} onClick={() => void runAuto()} disabled={busy}>
              Run automatic rules
            </Button>
          )}
          <Button icon={<Sparkles />} onClick={() => openAgent("Review the replenishment plan: what is late, what is covered by open orders, and what you would order or build this week. Then draft the purchase orders, one per supplier.")}>
            Ask Strato
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ReplenishmentStats rows={rows} />
        <ReplenishmentTable rows={rows} canWrite={writable} busy={busy} onOrder={(sel) => void order(sel)} onBuild={(item, qty) => setBuild({ item, qty })} onSnooze={(ids, until) => void snooze(ids, until)} onRule={(id, patch) => void rule(id, patch)} />
        <p className="text-[12px] text-text-tertiary">
          Forecast = on hand + incoming (open purchase orders, transfers in transit) − outgoing (open sales orders, parts for assemblies the plan says to build). An item is proposed when its forecast drops below the low line, up to its max (or twice its min), rounded up to its order multiple. Order by = when to place the order so it lands, at the last 90 days&apos; usage, before the shelf hits min. Orders go to the supplier&apos;s open draft when there is one.
        </p>
      </div>

      {build && <BuildModal open onClose={() => setBuild(null)} assembly={build.item} />}

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        size="sm"
        title="Replenishment"
        footer={
          <>
            <Button href="/orders/purchase">Purchase orders</Button>
            <Button variant="primary" onClick={() => setResult(null)}>
              Done
            </Button>
          </>
        }
      >
        {result && (
          <div className="flex flex-col gap-3 text-[13px]">
            {result.created.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Drafted</div>
                <ul className="flex flex-col gap-1">
                  {result.created.map((po) => (
                    <li key={po.id}>
                      <Link href={`/orders/purchase?highlight=${po.id}`} className="font-mono text-accent hover:underline">
                        {po.number}
                      </Link>
                      <span className="text-text-secondary"> · {po.supplier} · {pluralize(po.lines.length, "line")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.updated.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Added to open drafts</div>
                <ul className="flex flex-col gap-1">
                  {result.updated.map((po) => (
                    <li key={po.id}>
                      <Link href={`/orders/purchase?highlight=${po.id}`} className="font-mono text-accent hover:underline">
                        {po.number}
                      </Link>
                      <span className="text-text-secondary"> · {po.supplier} · now {pluralize(po.lines.length, "line")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.builds.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">To build</div>
                <ul className="flex flex-col gap-1">
                  {result.builds.map((b) => (
                    <li key={b.item.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono">{b.item.sku}</span> <span className="text-text-secondary">× {formatQty(b.qty, b.item.unit)}</span>
                      </span>
                      {writable && (
                        <Button size="sm" onClick={() => { setResult(null); setBuild({ item: b.item, qty: b.qty }); }}>
                          Build
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="text-text-secondary">
                Skipped: {result.skipped.map((s) => `${s.item.sku} (${s.reason})`).join(", ")}
              </div>
            )}
          </div>
        )}
      </Modal>
    </Page>
  );
}

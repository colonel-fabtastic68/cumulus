"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShoppingBag, Store } from "lucide-react";
import type { BridgePush, Integration, SalesOrder } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { formatDateTime, formatQty, formatRelative } from "@/lib/format";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Page, Table, useToast, type BadgeTone, type Column } from "@/components/ui";

const PUSH_TONE: Record<BridgePush["status"], BadgeTone> = { pushed: "success", pending: "attention", failed: "critical", skipped: "default" };
const PUSH_LABEL: Record<BridgePush["status"], string> = { pushed: "Sent to Square", pending: "Waiting", failed: "Not sent yet", skipped: "Nothing to send" };

function ConnectionCard({ title, icon, integration, lines, help }: { title: string; icon: React.ReactNode; integration?: Integration; lines: Array<[string, React.ReactNode]>; help: string }) {
  const connected = integration && integration.status !== "not_connected";
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {icon}
            {title}
          </span>
        }
        actions={<Badge tone={!connected ? "default" : integration!.status === "error" ? "critical" : "success"}>{!connected ? "Not connected" : integration!.status === "error" ? "Needs attention" : "Connected"}</Badge>}
      />
      {connected ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-text-secondary">
          {help}{" "}
          <Link href="/integrations" className="text-accent hover:underline">
            Connect it under Integrations
          </Link>
          .
        </p>
      )}
      {connected && integration!.lastError && (
        <Banner tone="warning" className="mt-3">
          {integration!.lastError}
        </Banner>
      )}
    </Card>
  );
}

export function BridgeView() {
  const integrations = useCollection("integrations");
  const orders = useCollection("orders");
  const items = useCollection("items");
  const user = useCurrentUser();
  const writable = canWrite(user);
  const api = useApi();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [lastRun, setLastRun] = useState<string[] | null>(null);
  const squareInt = integrations.find((i) => i.id === "square");
  const wooInt = integrations.find((i) => i.id === "woocommerce");
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const web = useMemo(() => orders.filter((o) => o.bridge).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [orders]);
  const stuck = web.filter((o) => o.bridge!.square.status === "failed" || o.bridge!.reversed?.square.status === "failed");

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ summary: string; lines: string[] }>("/api/ranch/sync");
      setLastRun(r.lines);
      toast("Sync finished", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed", "critical");
    } finally {
      setSyncing(false);
    }
  };

  const columns: Column<SalesOrder>[] = [
    {
      key: "order",
      header: "Web order",
      render: (o) => (
        <div className="min-w-0">
          <Link href={`/orders?highlight=${o.id}`} className="font-medium text-text hover:underline" onClick={(e) => e.stopPropagation()}>
            {o.externalRef ?? o.number}
          </Link>
          <div className="truncate text-[12px] text-text-tertiary">
            {o.number} · {o.customer}
          </div>
        </div>
      ),
      sortValue: (o) => o.createdAt,
      minWidth: 170,
    },
    { key: "packs", header: "Packs", render: (o) => <span className="text-text-secondary">{o.bridge!.packs.map((p) => `${p.packs} × ${p.name}`).join(", ")}</span>, minWidth: 220, flex: true },
    {
      key: "lb",
      header: "Taken",
      align: "right",
      render: (o) => {
        const lb = o.lines.reduce((s, l) => s + (l.shipped ?? 0), 0);
        return (
          <div>
            <div className="tabular-nums">{formatQty(Math.round(lb * 1000) / 1000, "lb")}</div>
            {o.bridge!.short?.length ? <div className="text-[12px] text-warning">{o.bridge!.short.map((s) => `${formatQty(s.qty, "lb")} ${byId.get(s.itemId)?.name ?? ""}`).join(", ")} short</div> : null}
          </div>
        );
      },
      minWidth: 110,
      priority: 1,
    },
    {
      key: "square",
      header: "Square",
      render: (o) => {
        const sale = o.bridge!.square;
        const back = o.bridge!.reversed?.square;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={PUSH_TONE[sale.status]} dot>
              {PUSH_LABEL[sale.status]}
            </Badge>
            {back && <Badge tone={PUSH_TONE[back.status]}>{back.status === "pushed" ? "Put back in Square" : `Cancelled: ${PUSH_LABEL[back.status].toLowerCase()}`}</Badge>}
            {(sale.error || back?.error) && <span className="max-w-[260px] truncate text-[12px] text-text-tertiary" title={back?.error ?? sale.error}>{back?.error ?? sale.error}</span>}
          </div>
        );
      },
      minWidth: 170,
    },
    { key: "when", header: "Paid", render: (o) => <span title={formatDateTime(o.createdAt)}>{formatRelative(o.createdAt)}</span>, sortValue: (o) => o.createdAt, minWidth: 100, priority: 2 },
  ];

  return (
    <Page
      title="Square & store"
      subtitle="Square counts come in per animal, packs go out to the store, and every web sale is taken from the oldest animal and sent back to Square."
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<RefreshCw />} loading={syncing} onClick={() => void sync()}>
            Sync now
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {stuck.length > 0 && (
          <Banner tone="warning" title={`${stuck.length} web order${stuck.length === 1 ? " has" : "s have"} not reached Square yet`}>
            Their pounds are already taken here, and counts from Square leave them alone until they go through. Sync now tries again; the daily pass does too.
          </Banner>
        )}
        {lastRun && (
          <Banner tone="info" title="Last sync" onDismiss={() => setLastRun(null)}>
            <ul className="mt-1 list-disc pl-4">
              {lastRun.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Banner>
        )}
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <ConnectionCard
            title="Square"
            icon={<Store className="h-4 w-4" />}
            integration={squareInt}
            help="Square holds the counts per animal (Lot #) at the counter."
            lines={[
              ["Business", squareInt?.config?.businessName ?? "–"],
              ["Counts from", squareInt?.config?.locationNames?.split(", ")[0] ?? squareInt?.config?.ranchLocationId ?? "–"],
              ["Live updates", squareInt?.webhooks?.length ? "On (count changes arrive as they happen)" : "Off (Sync now and the daily pass)"],
              ["Last counts", squareInt?.lastSyncAt ? `${formatRelative(squareInt.lastSyncAt)}: ${squareInt.lastSyncSummary ?? ""}` : "Not yet"],
            ]}
          />
          <ConnectionCard
            title="Web store"
            icon={<ShoppingBag className="h-4 w-4" />}
            integration={wooInt}
            help="WooCommerce sells the packs and sends paid orders here."
            lines={[
              ["Store", wooInt?.config?.siteName ?? wooInt?.config?.siteUrl ?? "–"],
              ["Orders in", wooInt?.webhooks?.length ? "Live (paid orders arrive as they happen)" : "Sync now and the daily pass"],
              ["Last push", wooInt?.lastSyncAt ? `${formatRelative(wooInt.lastSyncAt)}: ${wooInt.lastSyncSummary ?? ""}` : "Not yet"],
              ["Payments", "Taken by the store's Square gateway; nothing here touches them"],
            ]}
          />
        </div>
        <Table
          rows={web}
          columns={columns}
          rowKey={(o) => o.id}
          fit
          layoutKey="ranch-bridge"
          defaultSort={{ key: "when", dir: "desc" }}
          emptyState={<EmptyState icon={<ShoppingBag />} title="No web orders yet" description="Paid store orders show up here with the packs they held, the pounds taken and whether Square has them." />}
        />
      </div>
    </Page>
  );
}

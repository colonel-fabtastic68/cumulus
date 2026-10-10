"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, RefreshCw, ShoppingBag, Store } from "lucide-react";
import type { BridgePush, Integration, SalesOrder } from "@/lib/types";
import type { RanchMode } from "@/lib/ranch/squareTruth";
import { useRanchMode } from "./useRanchMode";
import { useCollection } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { formatDateTime, formatQty, formatRelative } from "@/lib/format";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Modal, Page, SimpleTable, Skeleton, Table, useToast, type BadgeTone, type Column } from "@/components/ui";

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


interface ModePlan {
  mode: RanchMode;
  applied: boolean;
  changes: Array<{ cut: string; animal: string; from: number; to: number }>;
  changed: number;
  negatives: number;
  negativeLb: number;
  summary: string;
}

const MODE_COPY: Record<RanchMode, { title: string; body: string }> = {
  square: {
    title: "Square keeps the counts",
    body: "Receive animals and recount in Square; the cuts and animals here follow Square's numbers. Web sales are taken off here and in Square.",
  },
  cumulus: {
    title: "cumulusOS keeps the counts",
    body: "Receive animals and recount on Animals; Square's counts are set from here, and new animals appear in Square as Lot # variations. Counter sales and refunds in Square come in as sales here. Anything else changed in Square is put back and noted in the activity log.",
  },
};

function CountsCard({ mode, squareConnected, canManage, onSwitch }: { mode: RanchMode; squareConnected: boolean; canManage: boolean; onSwitch: () => void }) {
  return (
    <Card>
      <CardHeader
        title="Who keeps the counts"
        actions={
          canManage && squareConnected ? (
            <Button icon={<ArrowRightLeft />} onClick={onSwitch}>
              {mode === "square" ? "Make cumulusOS the source of truth…" : "Hand the counts back to Square…"}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          {MODE_COPY[mode].title}
          <Badge tone={mode === "cumulus" ? "success" : "default"}>{mode === "cumulus" ? "cumulusOS" : "Square"}</Badge>
        </div>
        <p className="text-[13px] text-text-secondary">{MODE_COPY[mode].body}</p>
      </div>
    </Card>
  );
}

function ModeModal({ to, onClose }: { to: RanchMode; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [preview, setPreview] = useState<ModePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<ModePlan>("/api/ranch/square-mode", { mode: to, dryRun: true })
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not check Square"));
    return () => {
      cancelled = true;
    };
  }, [api, to]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api<ModePlan>("/api/ranch/square-mode", { mode: to });
      toast(to === "cumulus" ? `cumulusOS now keeps the counts. Square: ${r.summary}` : `Square keeps the counts again. ${r.summary}`, "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
    } finally {
      setBusy(false);
    }
  };

  const toCumulus = to === "cumulus";
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={toCumulus ? "Make cumulusOS the source of truth" : "Hand the counts back to Square"}
      subtitle={toCumulus ? "Square keeps selling at the counter; its counts are set from here from now on." : "Square becomes the record again and cumulusOS follows its counts."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!preview} onClick={() => void apply()}>
            {toCumulus ? "Make cumulusOS the source of truth" : "Hand back to Square"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {error && <Banner tone="critical">{error}</Banner>}
        {toCumulus ? (
          <>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-text-secondary">
              <li>Counts are brought up to date from Square first, so nothing sold at the counter is lost. Switch while the counter is not ringing up a sale.</li>
              <li>From then on, receive animals and recount on Animals, not in Square. A new animal is added to Square as a Lot # on each cut, at that cut&apos;s price.</li>
              <li>Counter sales and refunds keep working in Square and come in here. Recounts or edits made in Square are put back to the count here.</li>
              <li>The store&apos;s WooCommerce Square plugin must only take payments. If it also syncs inventory, its changes are put back.</li>
            </ul>
            {!preview && !error && <Skeleton className="h-24 w-full" />}
            {preview && (
              <div className="flex flex-col gap-2">
                <Banner tone={preview.changed ? "info" : "success"} title={preview.summary}>
                  {preview.negatives > 0 && `Square shows ${formatQty(Math.abs(preview.negativeLb), "lb")} below zero across ${preview.negatives} animal cut${preview.negatives === 1 ? "" : "s"}, sold past what was on hand. cumulusOS never goes below zero, so those become 0 in Square.`}
                </Banner>
                {preview.changes.length > 0 && (
                  <SimpleTable>
                    <thead>
                      <tr>
                        <th>Cut</th>
                        <th>Animal</th>
                        <th className="text-right">Square now</th>
                        <th className="text-right">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c, i) => (
                        <tr key={i}>
                          <td>{c.cut}</td>
                          <td className="text-text-secondary">{c.animal || "–"}</td>
                          <td className={`text-right tabular-nums ${c.from < 0 ? "text-critical" : ""}`}>{formatQty(c.from, "lb")}</td>
                          <td className="text-right tabular-nums">{formatQty(c.to, "lb")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </SimpleTable>
                )}
                {preview.changed > preview.changes.length && <p className="text-[12px] text-text-tertiary">…and {preview.changed - preview.changes.length} more.</p>}
              </div>
            )}
          </>
        ) : (
          <p className="text-text-secondary">{preview?.summary ?? "Checking…"} Animals received here stay; their counts in Square become the record.</p>
        )}
      </div>
    </Modal>
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
  const { mode, squareConnected } = useRanchMode();
  const canManage = user.role === "owner" || user.role === "admin";
  const [switchTo, setSwitchTo] = useState<RanchMode | null>(null);

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
      subtitle={mode === "cumulus" ? "cumulusOS keeps the counts per animal and sets Square's; counter sales come in from Square, packs go out to the store, and every web sale is taken from the oldest animal." : "Square counts come in per animal, packs go out to the store, and every web sale is taken from the oldest animal and sent back to Square."}
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
        <CountsCard mode={mode} squareConnected={squareConnected} canManage={canManage && writable} onSwitch={() => setSwitchTo(mode === "square" ? "cumulus" : "square")} />
        {switchTo && <ModeModal to={switchTo} onClose={() => setSwitchTo(null)} />}
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <ConnectionCard
            title="Square"
            icon={<Store className="h-4 w-4" />}
            integration={squareInt}
            help="Square sells at the counter, per animal (Lot #)."
            lines={[
              ["Business", squareInt?.config?.businessName ?? "–"],
              ["Location", squareInt?.config?.locationNames?.split(", ")[0] ?? squareInt?.config?.ranchLocationId ?? "–"],
              ["Counts", mode === "cumulus" ? "Set from here" : "Come from Square"],
              ["Live updates", squareInt?.webhooks?.length ? (mode === "cumulus" ? "On (counter sales arrive as they happen)" : "On (count changes arrive as they happen)") : "Off (Sync now and the daily pass)"],
              ["Last sync", squareInt?.lastSyncAt ? `${formatRelative(squareInt.lastSyncAt)}: ${squareInt.lastSyncSummary ?? ""}` : "Not yet"],
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

"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Cable, Plus } from "lucide-react";
import type { Connector, ConnectorKind, IntakeMessage } from "@/lib/types";
import { CONNECTOR_KIND_LABEL, INTAKE_CHANNEL_LABEL, connectorAddress, intakeIsOpen, intakeNeedsReading, orderDraftFrom, removeConnector, resolveMessage, setConnectorPaused } from "@/lib/connectors";
import { useCollection, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { useFeature } from "@/lib/useFeature";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatNumber, pluralize } from "@/lib/format";
import { Banner, Button, Card, ConfirmDialog, EmptyState, Page, QueryParamEffect, Stat, Tabs, useToast } from "@/components/ui";
import { ChannelCards, ConnectorModal, HandlingCard, IntakeDrawer, IntakeTable, LogMessageModal } from "@/components/connectors";
import { NewOrderModal } from "@/components/orders";

type Tab = "channels" | "intake";

const WEEK_MS = 7 * 86_400_000;

export default function ConnectorsPage() {
  const enabled = useFeature("connectors");
  const connectors = useCollection("connectors");
  const messages = useCollection("intakeMessages");
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const toast = useToast();
  const { mode } = useSession();
  const { setPageContext } = useAgent();

  const [tab, setTab] = useState<Tab>("channels");
  const [adding, setAdding] = useState<ConnectorKind | null>(null);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [removing, setRemoving] = useState<Connector | null>(null);
  const [logging, setLogging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<IntakeMessage | null>(null);
  const [weekAgo] = useState(() => new Date(Date.now() - WEEK_MS).toISOString());

  useEffect(() => {
    setPageContext({ page: "Connectors" });
  }, [setPageContext]);

  const onTabParam = useCallback((value: string) => {
    if (value === "channels" || value === "intake") setTab(value);
  }, []);
  const onMessageParam = useCallback((id: string) => {
    setTab("intake");
    setSelectedId(id);
  }, []);

  const selected = useMemo(() => messages.find((m) => m.id === selectedId) ?? null, [messages, selectedId]);
  const open = useMemo(() => messages.filter(intakeIsOpen), [messages]);
  const needReading = open.filter(intakeNeedsReading).length;
  const handled = messages.filter((m) => m.status === "done" && (m.handledAt ?? "") >= weekAgo);
  const byStrato = handled.filter((m) => m.handledBy === "Strato").length;
  const live = connectors.filter((c) => c.status === "live" && !c.paused).length;
  const phone = connectors.find((c) => c.kind === "phone");

  if (!enabled) {
    return (
      <Page title="Connectors">
        <Card padded={false}>
          <EmptyState icon={<Cable />} title="Connectors are not switched on" description="This feature is still in preview. It can be switched on under Settings → Labs where previews are available." action={<Button href="/settings#labs">Open Labs</Button>} />
        </Card>
      </Page>
    );
  }

  const pause = (connector: Connector, paused: boolean) => {
    void setConnectorPaused(store, connector.id, paused)
      .then(() => toast(paused ? `Paused ${connectorAddress(connector)}` : `${connectorAddress(connector)} is back on`, "success"))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "critical"));
  };

  const orderSource = ordering ? `${ordering.channel === "manual" ? "a message" : `${ordering.channel === "email" ? "an" : "a"} ${INTAKE_CHANNEL_LABEL[ordering.channel].toLowerCase()}`} from ${ordering.from}` : undefined;

  return (
    <Page
      title="Connectors"
      subtitle="Email, calls and texts come in here and are read into orders"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setLogging(true)}>
            Add a message
          </Button>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="tab" onValue={onTabParam} />
        <QueryParamEffect param="message" onValue={onMessageParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <Banner tone="info" title="Live intake is not switched on yet">
          Channels you add are saved with their settings and wait. Until mail, calls and texts arrive on their own, add a message by hand and it is read the same way.
          {mode !== "firestore" && " The sample company's channels and messages show what a working setup looks like."}
        </Banner>

        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
          <Stat label="Waiting for review" value={formatNumber(open.length)} hint={needReading ? `${formatNumber(needReading)} with lines that matched no item` : "Read and ready"} tone={open.length ? "default" : "success"} />
          <Stat label="Handled in the last 7 days" value={formatNumber(handled.length)} hint={byStrato ? `${formatNumber(byStrato)} by Strato` : "By the team"} />
          <Stat label="Channels" value={formatNumber(connectors.length)} hint={connectors.length ? `${formatNumber(live)} live` : "None connected"} className="col-span-2 @xl:col-span-1" />
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "channels", label: "Channels", count: connectors.length },
            { value: "intake", label: "Intake", count: open.length },
          ]}
          className="border-b-0 py-0"
        />

        {tab === "channels" ? (
          <>
            <ChannelCards connectors={connectors} canWrite={writable} onAdd={setAdding} onEdit={setEditing} onPause={pause} onRemove={setRemoving} />
            <HandlingCard canWrite={writable} />
          </>
        ) : (
          <IntakeTable messages={messages} canWrite={writable} onSelect={(m) => setSelectedId(m.id)} onAdd={() => setLogging(true)} />
        )}
      </div>

      <ConnectorModal open={!!adding || !!editing} kind={editing?.kind ?? adding ?? "email"} connector={editing} phoneNumber={phone?.address} onClose={() => (setAdding(null), setEditing(null))} />
      <LogMessageModal
        open={logging}
        onClose={() => setLogging(false)}
        onAdded={(m) => {
          setTab("intake");
          setSelectedId(m.id);
        }}
      />
      <IntakeDrawer message={selected} onClose={() => setSelectedId(null)} canWrite={writable} onCreateOrder={setOrdering} />
      <NewOrderModal
        open={!!ordering}
        template={ordering ? orderDraftFrom(ordering) : null}
        draftFrom={orderSource}
        onClose={() => setOrdering(null)}
        onCreated={(order) => {
          if (!ordering) return;
          // The order form announces the new order; here the message only needs closing.
          void resolveMessage(store, user, ordering.id, { status: "done", outcome: `Entered as ${order.number}`, orderId: order.id }).catch((e) => toast(e instanceof Error ? e.message : String(e), "critical"));
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        destructive
        title={removing ? `Remove ${connectorAddress(removing)}?` : "Remove channel?"}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          await removeConnector(store, user, removing.id);
          toast(`${CONNECTOR_KIND_LABEL[removing.kind]} removed`, "success");
          setRemoving(null);
        }}
        message={<>Nothing more is read from it. {pluralize(messages.filter((m) => m.connectorId === removing?.id).length, "message")} already in Intake stay there.</>}
      />
    </Page>
  );
}

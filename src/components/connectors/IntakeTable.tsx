"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardPaste, Inbox, Mail, MessageSquareText, Phone, Plus, Sparkles } from "lucide-react";
import type { IntakeChannel, IntakeIntent, IntakeMessage } from "@/lib/types";
import { INTAKE_CHANNEL_LABEL, INTAKE_INTENT_LABEL, connectorAddress, intakeIsOpen, intakeNeedsReading, reopenMessage, resolveMessage, stratoPrompt } from "@/lib/connectors";
import { useCollection, useItemsById, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { useTerms } from "@/lib/useTerms";
import { formatDateTime, formatQty, formatRelative, pluralize } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, Button, Drawer, EmptyState, SearchField, Segmented, StatusBadge, Table, TextField, useToast, type BadgeTone, type Column } from "@/components/ui";

const CHANNEL_ICON: Record<IntakeChannel, ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  sms: <MessageSquareText className="h-3.5 w-3.5" />,
  manual: <ClipboardPaste className="h-3.5 w-3.5" />,
};

const INTENT_TONE: Record<IntakeIntent, BadgeTone> = { order: "info", change: "attention", status: "default", quote: "default", supplier: "default", other: "default" };

export function IntakeStatusBadge({ message }: { message: IntakeMessage }) {
  if (message.status === "done") return <Badge tone="success">Done</Badge>;
  if (message.status === "dismissed") return <Badge>Dismissed</Badge>;
  return intakeNeedsReading(message) ? <Badge tone="attention">Needs a person</Badge> : <Badge tone="info">To review</Badge>;
}

type Filter = "open" | "handled" | "all";

/** Everything that has come in, newest first. */
export function IntakeTable({ messages, canWrite, onSelect, onAdd }: { messages: IntakeMessage[]; canWrite: boolean; onSelect: (message: IntakeMessage) => void; onAdd: () => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");

  const open = useMemo(() => messages.filter(intakeIsOpen), [messages]);
  const rows = useMemo(() => {
    const list = filter === "all" ? messages : filter === "open" ? open : messages.filter((m) => !intakeIsOpen(m));
    return q.trim() ? list.filter((m) => matches(q, m.from, m.fromAddress, m.subject, m.body, m.outcome)) : list;
  }, [messages, open, filter, q]);

  const columns = useMemo<Column<IntakeMessage>[]>(
    () => [
      {
        key: "received",
        header: "Received",
        width: "110px",
        sortValue: (m) => m.receivedAt,
        render: (m) => (
          <span className="whitespace-nowrap text-text-secondary" title={formatDateTime(m.receivedAt)}>
            {formatRelative(m.receivedAt)}
          </span>
        ),
      },
      {
        key: "channel",
        header: "Channel",
        width: "130px",
        hideBelow: "md",
        sortValue: (m) => m.channel,
        render: (m) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
            {CHANNEL_ICON[m.channel]}
            {INTAKE_CHANNEL_LABEL[m.channel]}
          </span>
        ),
      },
      {
        key: "from",
        header: "From",
        sortValue: (m) => m.from,
        render: (m) => (
          <span className="block min-w-0">
            <span className="block max-w-[240px] truncate font-medium text-text" title={m.from}>
              {m.from}
            </span>
            <span className="block max-w-[420px] truncate text-text-secondary" title={m.subject ?? m.body}>
              {m.subject ? `${m.subject}: ` : ""}
              {m.body.replace(/\s+/g, " ")}
            </span>
          </span>
        ),
      },
      { key: "intent", header: "About", width: "140px", hideBelow: "sm", sortValue: (m) => INTAKE_INTENT_LABEL[m.intent], render: (m) => <Badge tone={INTENT_TONE[m.intent]}>{INTAKE_INTENT_LABEL[m.intent]}</Badge> },
      { key: "lines", header: "Lines read", width: "100px", align: "right", hideBelow: "lg", sortValue: (m) => m.lines?.length ?? 0, render: (m) => <span className="text-text-secondary">{m.lines?.length ? m.lines.length : "—"}</span> },
      { key: "status", header: "Status", width: "140px", sortValue: (m) => m.status, render: (m) => <IntakeStatusBadge message={m} /> },
    ],
    [],
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(m) => m.id}
      rowLabel={(m) => `${INTAKE_CHANNEL_LABEL[m.channel]} from ${m.from}`}
      onRowClick={onSelect}
      defaultSort={{ key: "received", dir: "desc" }}
      pageSize={25}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "To review", count: open.length },
              { value: "handled", label: "Handled", count: messages.length - open.length },
              { value: "all", label: "All", count: messages.length },
            ]}
          />
          <SearchField value={q} onChange={setQ} placeholder="Search sender or message" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      emptyState={
        <EmptyState
          icon={<Inbox />}
          title={messages.length === 0 ? "Nothing has come in yet" : filter === "open" && !q.trim() ? "Nothing waiting" : "No messages match"}
          description={
            messages.length === 0
              ? "Messages from the connected channels land here. You can also add one by hand: paste an email or a text, or type what a caller asked for."
              : filter === "open" && !q.trim()
                ? "Every message has been handled."
                : "Try another filter or search."
          }
          action={
            messages.length === 0 && canWrite ? (
              <Button variant="primary" size="sm" icon={<Plus />} onClick={onAdd}>
                Add a message
              </Button>
            ) : undefined
          }
        />
      }
      footer={`${rows.length} of ${pluralize(messages.length, "message")}`}
    />
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

interface DrawerProps {
  message: IntakeMessage | null;
  onClose: () => void;
  canWrite: boolean;
  onCreateOrder: (message: IntakeMessage) => void;
}

/** One message: what was said, what was read from it and what to do next. */
export function IntakeDrawer(props: DrawerProps) {
  if (!props.message) return null;
  return <IntakeDrawerBody key={props.message.id} {...props} message={props.message} />;
}

function IntakeDrawerBody({ message, onClose, canWrite, onCreateOrder }: DrawerProps & { message: IntakeMessage }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const agent = useAgent();
  const terms = useTerms();
  const itemsById = useItemsById();
  const orders = useCollection("orders");
  const connectors = useCollection("connectors");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const order = message.orderId ? orders.find((o) => o.id === message.orderId) : undefined;
  const connector = message.connectorId ? connectors.find((c) => c.id === message.connectorId) : undefined;
  const lines = message.lines ?? [];
  const open = intakeIsOpen(message);
  const canOrder = open && (lines.length > 0 || message.intent === "order");

  const close = async (status: "done" | "dismissed") => {
    setBusy(true);
    try {
      await resolveMessage(store, user, message.id, { status, outcome: note });
      toast(status === "done" ? "Marked done" : "Dismissed", "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={540}
      title={message.from}
      subtitle={[INTAKE_CHANNEL_LABEL[message.channel], formatDateTime(message.receivedAt), connector ? `to ${connectorAddress(connector)}` : null].filter(Boolean).join(" · ")}
      headerActions={
        <Button size="sm" icon={<Sparkles />} onClick={() => agent.open(stratoPrompt(message))}>
          Hand to Strato
        </Button>
      }
      footer={
        !canWrite ? undefined : open ? (
          <>
            <Button variant="plain" className="mr-auto" onClick={() => void close("dismissed")} disabled={busy}>
              Dismiss
            </Button>
            <Button variant={canOrder ? "secondary" : "primary"} onClick={() => void close("done")} loading={busy}>
              Mark done
            </Button>
            {canOrder && (
              <Button variant="primary" onClick={() => onCreateOrder(message)}>
                Create order
              </Button>
            )}
          </>
        ) : (
          <Button onClick={() => void reopenMessage(store, message.id).catch((e) => toast(e instanceof Error ? e.message : String(e), "critical"))}>Reopen</Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={INTENT_TONE[message.intent]}>{INTAKE_INTENT_LABEL[message.intent]}</Badge>
          <IntakeStatusBadge message={message} />
          {message.fromAddress && message.fromAddress !== message.from && <span className="break-all font-mono text-[12px] text-text-secondary">{message.fromAddress}</span>}
        </div>

        {!open && (
          <p className="rounded-[var(--radius)] border border-border px-3 py-2 text-[12.5px] text-text-secondary">
            {message.status === "done" ? "Done" : "Dismissed"}
            {message.handledBy ? ` by ${message.handledBy}` : ""}
            {message.handledAt ? `, ${formatRelative(message.handledAt)}` : ""}
            {message.outcome ? <span className="text-text">: {message.outcome}</span> : "."}
          </p>
        )}

        <Block title={message.channel === "phone" ? "What the caller asked for" : "Message"}>
          <div className="rounded-[var(--radius)] bg-surface-subdued p-3 text-[13px] leading-5 text-text">
            {message.subject && <div className="mb-1.5 font-medium">{message.subject}</div>}
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>
        </Block>

        {lines.length > 0 && (
          <Block title="Lines read from the message">
            <div className="overflow-hidden rounded-[var(--radius)] border border-border">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-text-tertiary">
                    <th className="px-3 py-1.5 font-medium">{terms.itemCode}</th>
                    <th className="px-3 py-1.5 font-medium">Item</th>
                    <th className="px-3 py-1.5 text-right font-medium">Asked for</th>
                    <th className="px-3 py-1.5 text-right font-medium">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const item = itemsById.get(l.itemId);
                    return (
                      <tr key={l.itemId} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 align-top font-mono text-[12px] text-text">{item?.sku ?? "—"}</td>
                        <td className="px-3 py-1.5 align-top text-text-secondary">{item?.name ?? "This item was deleted"}</td>
                        <td className="px-3 py-1.5 text-right align-top tabular text-text">{formatQty(l.qty)}</td>
                        <td className={cn("px-3 py-1.5 text-right align-top tabular", item && item.onHand < l.qty ? "font-medium text-critical" : "text-text-secondary")}>{item ? formatQty(item.onHand) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Block>
        )}

        {(message.unmatched?.length ?? 0) > 0 && (
          <Block title="Could not match to an item">
            <ul className="flex flex-col gap-1 text-[13px] text-text">
              {message.unmatched!.map((u) => (
                <li key={u} className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5">
                  {u}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-text-tertiary">Add these on the order yourself, or hand the message to Strato to work out which items they mean.</p>
          </Block>
        )}

        {order && (
          <Block title={message.status === "done" && message.intent === "order" ? "Order created" : "Order"}>
            <Link href={`/orders?highlight=${order.id}`} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-2 text-[13px] transition-colors hover:bg-surface-subdued">
              <span className="min-w-0">
                <span className="font-medium text-text">{order.number}</span>
                <span className="text-text-secondary"> · {order.customer}</span>
              </span>
              <StatusBadge status={order.status} />
            </Link>
          </Block>
        )}

        {open && canWrite && <TextField label="What was done" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called back, replied with tracking" help="Kept with the message when you mark it done." />}
      </div>
    </Drawer>
  );
}

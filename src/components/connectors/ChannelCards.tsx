"use client";

import type { ReactNode } from "react";
import { Ellipsis, Mail, MessageSquareText, Pencil, Phone, Plus, Settings2 } from "lucide-react";
import type { Connector, ConnectorKind } from "@/lib/types";
import { TOPIC_SHORT, answerSummary, connectorAddress, formatPhone } from "@/lib/connectors";
import { Badge, Button, Menu } from "@/components/ui";

export function ConnectorStatusBadge({ connector }: { connector: Pick<Connector, "status" | "paused"> }) {
  if (connector.paused) return <Badge>Paused</Badge>;
  return connector.status === "live" ? <Badge tone="success">Live</Badge> : <Badge tone="attention">Not live yet</Badge>;
}

interface CardActions {
  canWrite: boolean;
  onAdd: (kind: ConnectorKind) => void;
  onEdit: (connector: Connector) => void;
  onPause: (connector: Connector, paused: boolean) => void;
  onRemove: (connector: Connector) => void;
}

function ChannelCard({ icon, title, description, children, footer }: { icon: ReactNode; title: string; description: string; children?: ReactNode; footer: ReactNode }) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-hover text-text-secondary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-text">{title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.45] text-text-secondary">{description}</p>
        </div>
      </div>
      {children}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">{footer}</div>
    </div>
  );
}

function Facts({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-text-tertiary">{r.label}</dt>
          <dd className="min-w-0 text-text">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MoreMenu({ connector, actions, withEdit }: { connector: Connector; actions: CardActions; withEdit?: boolean }) {
  return (
    <Menu
      align="right"
      trigger={<Button size="sm" variant="plain" icon={<Ellipsis />} aria-label={`More for ${connectorAddress(connector)}`} />}
      items={[
        ...(withEdit ? [{ label: "Edit", icon: <Pencil />, onSelect: () => actions.onEdit(connector) }] : []),
        { label: connector.paused ? "Switch back on" : "Pause", onSelect: () => actions.onPause(connector, !connector.paused) },
        "divider" as const,
        { label: "Remove", destructive: true, onSelect: () => actions.onRemove(connector) },
      ]}
    />
  );
}

const topicsOf = (c: Connector) => c.topics.map((t) => TOPIC_SHORT[t]).join(", ");

/** The three kinds of channel side by side: every inbox, the phone line and the text line. */
export function ChannelCards({ connectors, ...actions }: { connectors: Connector[] } & CardActions) {
  const inboxes = connectors.filter((c) => c.kind === "email").sort((a, b) => a.address.localeCompare(b.address));
  const phone = connectors.find((c) => c.kind === "phone");
  const text = connectors.find((c) => c.kind === "sms");
  const { canWrite } = actions;

  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
      <ChannelCard
        icon={<Mail />}
        title="Email"
        description="Orders and questions sent to these inboxes are read as they arrive. Connect as many as the business uses."
        footer={
          <>
            <span className="text-[12px] text-text-tertiary">{inboxes.length === 0 ? "No inbox connected" : `${inboxes.length} ${inboxes.length === 1 ? "inbox" : "inboxes"}`}</span>
            {canWrite && (
              <Button size="sm" variant={inboxes.length ? "secondary" : "primary"} icon={<Plus />} onClick={() => actions.onAdd("email")}>
                Add inbox
              </Button>
            )}
          </>
        }
      >
        {inboxes.length > 0 && (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {inboxes.map((c) => (
              <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="break-all font-mono text-[12px] text-text">{c.address}</span>
                    <ConnectorStatusBadge connector={c} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-text-tertiary">
                    {c.name ? `${c.name} · ` : ""}
                    {topicsOf(c)}
                  </div>
                </div>
                {canWrite && <MoreMenu connector={c} actions={actions} withEdit />}
              </li>
            ))}
          </ul>
        )}
      </ChannelCard>

      <ChannelCard
        icon={<Phone />}
        title="Phone"
        description="Strato answers the line, takes the order or looks one up, and hands the caller to a person when asked. ElevenLabs gives it a voice; Gemini works out what the caller needs."
        footer={
          phone ? (
            <>
              <ConnectorStatusBadge connector={phone} />
              {canWrite && (
                <span className="flex items-center gap-1">
                  <MoreMenu connector={phone} actions={actions} />
                  <Button size="sm" icon={<Settings2 />} onClick={() => actions.onEdit(phone)}>
                    Manage
                  </Button>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-[12px] text-text-tertiary">No phone line</span>
              {canWrite && (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => actions.onAdd("phone")}>
                  Set up phone line
                </Button>
              )}
            </>
          )
        }
      >
        {phone?.voice && (
          <Facts
            rows={[
              { label: "Number", value: <span className="font-mono text-[12px]">{formatPhone(phone.address)}</span> },
              { label: "Answers", value: answerSummary(phone.voice) },
              ...(phone.voice.transferTo ? [{ label: "Hands off to", value: <span className="font-mono text-[12px]">{formatPhone(phone.voice.transferTo)}</span> }] : []),
              { label: "Callers can", value: topicsOf(phone) },
            ]}
          />
        )}
      </ChannelCard>

      <ChannelCard
        icon={<MessageSquareText />}
        title="Text messages"
        description="Customers text an order or a question to the business number. Each one is read as it arrives and answered in the same thread."
        footer={
          text ? (
            <>
              <ConnectorStatusBadge connector={text} />
              {canWrite && (
                <span className="flex items-center gap-1">
                  <MoreMenu connector={text} actions={actions} />
                  <Button size="sm" icon={<Settings2 />} onClick={() => actions.onEdit(text)}>
                    Manage
                  </Button>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-[12px] text-text-tertiary">No text line</span>
              {canWrite && (
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => actions.onAdd("sms")}>
                  Set up texting
                </Button>
              )}
            </>
          )
        }
      >
        {text && (
          <Facts
            rows={[
              { label: "Number", value: <span className="font-mono text-[12px]">{formatPhone(text.address)}</span> },
              { label: "Replies", value: text.replies === "send" ? "Sent right away" : "Drafted for a person to send" },
              { label: "Unknown numbers", value: text.unknownSenders === "answer" ? "Answered, and asked who they are" : "Held for a person" },
              { label: "Customers can", value: topicsOf(text) },
            ]}
          />
        )}
      </ChannelCard>
    </div>
  );
}

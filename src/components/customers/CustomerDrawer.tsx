"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MessageSquareText, Pencil, Trash2 } from "lucide-react";
import type { Customer } from "@/lib/types";
import { Badge, Button, ConfirmDialog, DescriptionList, Drawer, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { customerHistory, deleteCustomer } from "@/lib/customers";
import { formatDate, formatMoney, formatRelative, pluralize } from "@/lib/format";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { CustomerModal } from "./CustomerModal";

/** One customer with everything on record: orders, returns and quotes, matched by id, email or name. */
export function CustomerDrawer({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { currency } = useSettings();
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const quotes = useCollection("quotes");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const writable = canWrite(user);
  const history = useMemo(() => (customer ? customerHistory(customer, { orders, rmas, quotes }) : null), [customer, orders, rmas, quotes]);

  return (
    <>
      <Drawer
        open={!!customer}
        onClose={onClose}
        title={customer?.name}
        subtitle={customer ? [customer.company, customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details yet" : undefined}
        width={520}
        headerActions={
          writable && customer ? (
            <>
              <Button size="sm" variant="plain" icon={<Pencil />} aria-label="Edit customer" onClick={() => setEditing(true)} />
              <Button size="sm" variant="plain" icon={<Trash2 />} aria-label="Delete customer" className="text-critical" onClick={() => setConfirm(true)} />
            </>
          ) : undefined
        }
      >
        {customer && history && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<MessageSquareText />} disabled title="Mass texts to customers are coming soon">
                Text
              </Button>
              <Button size="sm" icon={<Mail />} disabled title="Mass email to customers is coming soon">
                Email
              </Button>
              <Badge tone="attention">Coming soon</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Orders" value={String(history.orders.length)} />
              <Stat label="Revenue" value={formatMoney(history.revenue, currency)} />
              <Stat label="Last order" value={history.lastOrderAt ? formatRelative(history.lastOrderAt) : "—"} />
            </div>
            <DescriptionList
              rows={[
                { label: "Email", value: customer.email ? <a href={`mailto:${customer.email}`} className="text-accent hover:underline">{customer.email}</a> : "—" },
                { label: "Phone", value: customer.phone ?? "—" },
                { label: "Company", value: customer.company ?? "—" },
                { label: "Address", value: customer.address ? [customer.address.street1, customer.address.street2, `${customer.address.city}${customer.address.state ? ", " + customer.address.state : ""} ${customer.address.zip}`, customer.address.country].filter(Boolean).join(", ") : "—" },
                { label: "Tags", value: customer.tags?.length ? <span className="flex flex-wrap gap-1">{customer.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : "—" },
                { label: "Source", value: customer.source ?? "manual" },
                { label: "Added", value: formatDate(customer.createdAt) },
              ]}
            />
            {customer.notes && <p className="whitespace-pre-wrap rounded-[var(--radius)] bg-surface-subdued p-3 text-[13px] leading-5 text-text">{customer.notes}</p>}

            <Section title={`Orders (${history.orders.length})`}>
              {history.orders.length === 0 ? <Empty>No orders yet.</Empty> : history.orders.slice(0, 12).map((o) => (
                <Row key={o.id} href={`/orders?highlight=${o.id}`} label={o.number} sub={`${formatDate(o.createdAt)} · ${pluralize(o.lines.length, "line")} · ${formatMoney(o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), currency)}`} badge={o.status} />
              ))}
            </Section>
            <Section title={`Returns (${history.rmas.length})`}>
              {history.rmas.length === 0 ? <Empty>No returns.</Empty> : history.rmas.slice(0, 8).map((r) => <Row key={r.id} href={`/rmas?highlight=${r.id}`} label={r.number} sub={formatDate(r.createdAt)} badge={r.status} />)}
            </Section>
            <Section title={`Quotes (${history.quotes.length})`}>
              {history.quotes.length === 0 ? <Empty>No quotes.</Empty> : history.quotes.slice(0, 8).map((q) => <Row key={q.id} href={`/strato/quotes?highlight=${q.id}`} label={q.number} sub={formatDate(q.createdAt)} badge={q.status} />)}
            </Section>
          </div>
        )}
      </Drawer>
      <CustomerModal open={editing} customer={customer} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        destructive
        title={`Delete ${customer?.name}?`}
        confirmLabel="Delete"
        message={<>Orders, returns and quotes stay as they are; they just stop linking here.</>}
        onConfirm={async () => {
          if (!customer) return;
          await deleteCustomer(store, customer.id);
          toast(`Deleted ${customer.name}`, "success");
          setConfirm(false);
          onClose();
        }}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-subdued px-3 py-2">
      <div className="text-[11.5px] text-text-tertiary">{label}</div>
      <div className="truncate text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      <div className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-[12.5px] text-text-tertiary">{children}</p>;
}

function Row({ href, label, sub, badge }: { href: string; label: string; sub: string; badge: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-hover">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        <span className="block truncate text-[12px] text-text-secondary">{sub}</span>
      </span>
      <Badge tone={badge === "fulfilled" || badge === "accepted" || badge === "restocked" ? "success" : badge === "cancelled" || badge === "rejected" ? "critical" : "default"}>{badge}</Badge>
    </Link>
  );
}

import type { Connector, ConnectorKind, ConnectorTopic, IntakeChannel, IntakeIntent, IntakeMessage, IntakeSettings, OrderTemplate, VoiceLine, WorkspaceSettings } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { activityOp, InventoryError, type Actor } from "@/lib/inventory";
import { readMessage } from "@/lib/intake";
import { newId, nowIso } from "@/lib/utils";

/**
 * Connectors: the inboxes, phone line and text line that orders and questions
 * come in through, and the queue of what arrived (Orders → Connectors).
 *
 * A connector saved here is a record of the channel and how it should behave.
 * Live intake (reading a mailbox, answering a call, replying to a text) is not
 * wired yet, so new connectors stay "pending". Messages added by hand go
 * through the same reader (src/lib/intake.ts) the live channels will use.
 */

export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = { email: "Email inbox", phone: "Phone line", sms: "Text line" };

export const INTAKE_CHANNEL_LABEL: Record<IntakeChannel, string> = { email: "Email", phone: "Call", sms: "Text", manual: "Added by hand" };

export const INTAKE_INTENT_LABEL: Record<IntakeIntent, string> = { order: "New order", change: "Order change", status: "Order status", quote: "Price or stock", supplier: "Supplier update", other: "Other" };

export const TOPIC_LABEL: Record<ConnectorTopic, string> = {
  orders: "Take orders",
  status: "Answer where an order stands",
  stock: "Answer stock and price questions",
  supplier: "Read supplier confirmations, ship dates and price changes",
  message: "Take a message for the team",
};

/** The same topics as short words, for a channel's summary line. */
export const TOPIC_SHORT: Record<ConnectorTopic, string> = { orders: "Orders", status: "Order status", stock: "Stock and price", supplier: "Supplier updates", message: "Messages" };

/** What each kind of channel can be read for, in the order the forms list them. */
export const TOPICS_FOR: Record<ConnectorKind, ConnectorTopic[]> = {
  email: ["orders", "status", "stock", "supplier"],
  phone: ["orders", "status", "stock", "message"],
  sms: ["orders", "status", "stock"],
};

export const MAIL_LABEL: Record<NonNullable<Connector["mail"]>, string> = { google: "Google Workspace or Gmail", microsoft: "Microsoft 365 or Outlook", forward: "Another mail service, by forwarding" };

export const ANSWER_LABEL: Record<VoiceLine["answer"], string> = { always: "Every call", after_hours: "Outside business hours", no_answer: "When nobody picks up" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digitsOf = (s: string) => s.replace(/\D/g, "");

/** "(312) 555-0142" for a US number; anything else as typed. */
export function formatPhone(raw: string): string {
  const d = digitsOf(raw);
  const local = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (local.length !== 10) return raw.trim();
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** "9:00 AM" from a 24-hour "09:00". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || !Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** When the phone line picks up, in a sentence: "Outside business hours (9:00 AM to 5:00 PM, weekdays)". */
export function answerSummary(voice: VoiceLine): string {
  if (voice.answer !== "after_hours" || !voice.hours) return ANSWER_LABEL[voice.answer];
  return `${ANSWER_LABEL.after_hours} (${formatClock(voice.hours.open)} to ${formatClock(voice.hours.close)}, ${voice.hours.days === "weekdays" ? "weekdays" : "every day"})`;
}

/** An email address in lower case, or a phone number's digits: how two addresses are compared. */
function addressKey(kind: ConnectorKind, address: string): string {
  return kind === "email" ? address.trim().toLowerCase() : digitsOf(address).slice(-10);
}

export function connectorAddress(c: Pick<Connector, "kind" | "address">): string {
  return c.kind === "email" ? c.address : formatPhone(c.address);
}

export function defaultGreeting(companyName: string): string {
  const who = companyName.trim();
  return `Thanks for calling${who ? ` ${who}` : ""}. This is Strato, the assistant for the team. I can take an order, check on one, or get you to a person.`;
}

export interface ConnectorInput {
  kind: ConnectorKind;
  name?: string;
  address: string;
  topics: ConnectorTopic[];
  replies?: Connector["replies"];
  mail?: Connector["mail"];
  unknownSenders?: Connector["unknownSenders"];
  voice?: VoiceLine;
}

function cleanVoice(voice?: VoiceLine): VoiceLine | undefined {
  if (!voice) return undefined;
  const hours = voice.answer === "after_hours" ? voice.hours : undefined;
  if (voice.answer === "after_hours") {
    if (!hours?.open || !hours.close) throw new InventoryError("Enter the hours the business is open");
    if (hours.close <= hours.open) throw new InventoryError("Closing time is before opening time");
  }
  const transferTo = voice.transferTo?.trim();
  if (transferTo && digitsOf(transferTo).length < 10) throw new InventoryError("Enter the full number callers are handed to, with the area code");
  return {
    answer: voice.answer,
    ...(hours ? { hours } : {}),
    ...(voice.greeting?.trim() ? { greeting: voice.greeting.trim() } : {}),
    ...(voice.voiceId?.trim() ? { voiceId: voice.voiceId.trim() } : {}),
    ...(transferTo ? { transferTo } : {}),
    keepTranscripts: voice.keepTranscripts ?? true,
  };
}

/** Adds a channel, or saves changes to one. A new channel waits as "pending" until live intake reaches it. */
export async function saveConnector(store: Store, actor: Actor, input: ConnectorInput, existingId?: string): Promise<Connector> {
  const address = input.address.trim();
  if (input.kind === "email") {
    if (!EMAIL.test(address)) throw new InventoryError("Enter the inbox's full email address");
  } else if (digitsOf(address).length < 10 || digitsOf(address).length > 15) {
    throw new InventoryError("Enter the full phone number, with the area code");
  }
  const topics = TOPICS_FOR[input.kind].filter((t) => input.topics.includes(t));
  if (topics.length === 0) throw new InventoryError("Choose at least one thing this channel is for");

  const all = await store.list("connectors");
  const others = all.filter((c) => c.id !== existingId && c.kind === input.kind);
  if (input.kind !== "email" && others.length > 0) throw new InventoryError(`This workspace already has a ${CONNECTOR_KIND_LABEL[input.kind].toLowerCase()}. Open it to change the number.`);
  const key = addressKey(input.kind, address);
  if (others.some((c) => addressKey(c.kind, c.address) === key)) throw new InventoryError(`${address} is already connected`);

  const existing = existingId ? all.find((c) => c.id === existingId) : undefined;
  if (existingId && !existing) throw new InventoryError("That channel no longer exists");
  const now = nowIso();
  const connector: Connector = {
    id: existing?.id ?? newId("con"),
    kind: input.kind,
    address: input.kind === "email" ? address.toLowerCase() : address,
    status: existing?.status ?? "pending",
    topics,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor.id,
    ...(existing?.paused ? { paused: true } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.kind !== "phone" ? { replies: input.replies ?? "draft" } : {}),
    ...(input.kind === "email" ? { mail: input.mail ?? "google" } : {}),
    ...(input.kind === "sms" ? { unknownSenders: input.unknownSenders ?? "review" } : {}),
    ...(input.kind === "phone" ? { voice: cleanVoice(input.voice ?? { answer: "after_hours" }) } : {}),
  };
  await store.batch([
    { op: "put", collection: "connectors", doc: connector },
    ...(existing ? [] : [activityOp(actor, "connector.added", `${actor.name} added the ${CONNECTOR_KIND_LABEL[connector.kind].toLowerCase()} ${connectorAddress(connector)}`, { entityType: "connector", entityId: connector.id })]),
  ]);
  return connector;
}

export async function setConnectorPaused(store: Store, id: string, paused: boolean): Promise<void> {
  // A top-level undefined in a patch clears the field.
  await store.patch("connectors", id, { paused: paused || undefined, updatedAt: nowIso() });
}

export async function removeConnector(store: Store, actor: Actor, id: string): Promise<void> {
  const connector = await store.get("connectors", id);
  if (!connector) return;
  await store.batch([
    { op: "remove", collection: "connectors", id },
    activityOp(actor, "connector.removed", `${actor.name} removed the ${CONNECTOR_KIND_LABEL[connector.kind].toLowerCase()} ${connectorAddress(connector)}`, { entityType: "connector", entityId: id }),
  ]);
}

// ---- The queue ------------------------------------------------------------

export function intakeIsOpen(m: Pick<IntakeMessage, "status">): boolean {
  return m.status === "new";
}

/** Open messages with lines read are ready to become an order; the rest need a person or Strato to work out. */
export function intakeNeedsReading(m: Pick<IntakeMessage, "status" | "intent" | "lines" | "unmatched">): boolean {
  if (m.status !== "new") return false;
  if (m.intent !== "order" && m.intent !== "change" && m.intent !== "quote") return false;
  return (m.lines?.length ?? 0) === 0 || (m.unmatched?.length ?? 0) > 0;
}

export interface LogMessageInput {
  channel: IntakeChannel;
  connectorId?: string;
  from?: string;
  fromAddress?: string;
  subject?: string;
  body: string;
}

/** Adds a message to the queue by hand and reads it against the catalog, the way a live channel's messages are read. */
export async function logMessage(store: Store, input: LogMessageInput): Promise<IntakeMessage> {
  const body = input.body.trim();
  if (!body) throw new InventoryError("Paste or type the message");
  const fromAddress = input.fromAddress?.trim() || undefined;
  const typedName = input.from?.trim() || undefined;
  const [items, orders, customers, suppliers] = await Promise.all([store.list("items"), store.list("orders"), store.list("customers"), store.list("suppliers")]);
  const reading = readMessage({ from: typedName, fromAddress, subject: input.subject, body }, { items, orders, customers, suppliers });
  const now = nowIso();
  const message: IntakeMessage = {
    id: newId("msg"),
    channel: input.channel,
    from: typedName ?? reading.knownAs ?? fromAddress ?? "Unknown sender",
    body,
    receivedAt: now,
    intent: reading.intent,
    status: "new",
    createdAt: now,
    ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    ...(fromAddress ? { fromAddress } : {}),
    ...(reading.customerId ? { customerId: reading.customerId } : {}),
    ...(input.subject?.trim() ? { subject: input.subject.trim() } : {}),
    ...(reading.lines.length ? { lines: reading.lines } : {}),
    ...(reading.unmatched.length ? { unmatched: reading.unmatched } : {}),
    ...(reading.orderId ? { orderId: reading.orderId } : {}),
  };
  await store.put("intakeMessages", message);
  return message;
}

/** Closes a message: done with a line on what was done about it, or dismissed as nothing to do. */
export async function resolveMessage(store: Store, actor: Actor, id: string, result: { status: "done" | "dismissed"; outcome?: string; orderId?: string }): Promise<void> {
  const message = await store.get("intakeMessages", id);
  if (!message) throw new InventoryError("That message is no longer in the queue");
  await store.patch("intakeMessages", id, {
    status: result.status,
    outcome: result.outcome?.trim() || undefined,
    handledBy: actor.name,
    handledAt: nowIso(),
    ...(result.orderId ? { orderId: result.orderId } : {}),
  });
}

export async function reopenMessage(store: Store, id: string): Promise<void> {
  await store.patch("intakeMessages", id, { status: "new", outcome: undefined, handledBy: undefined, handledAt: undefined });
}

/** A message's lines as a starting point for the new-order form. */
export function orderDraftFrom(message: IntakeMessage): OrderTemplate {
  return {
    id: `intake_${message.id}`,
    name: "",
    customer: message.from,
    customerEmail: message.fromAddress?.includes("@") ? message.fromAddress : undefined,
    lines: message.lines ?? [],
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    createdBy: "",
  };
}

const STRATO_ASK: Record<IntakeIntent, string> = {
  order: "Work out which items and quantities they want and draft the sales order for me to approve.",
  change: "Find the order they mean and tell me what would change before you change anything.",
  status: "Look up the order and draft a short reply saying where it stands.",
  quote: "Check stock and pricing for what they ask about and draft a reply.",
  supplier: "Tell me what this changes for our items, costs or open purchase orders.",
  other: "Tell me what they need and what you would do about it.",
};

/** The message as a prompt for the Strato panel. */
export function stratoPrompt(message: IntakeMessage): string {
  const how = message.channel === "manual" ? "A message" : message.channel === "phone" ? "A call" : message.channel === "sms" ? "A text" : "An email";
  const who = message.fromAddress && message.fromAddress !== message.from ? `${message.from} (${message.fromAddress})` : message.from;
  const text = [message.subject, message.body].filter(Boolean).join("\n");
  return `${how} came in from ${who}:\n\n"""\n${text}\n"""\n\n${STRATO_ASK[message.intent]}`;
}

/** The handling rules with their defaults filled in: every order waits for a person, nothing is answered alone. */
export function intakeRules(settings: Pick<WorkspaceSettings, "intake">): Required<Pick<IntakeSettings, "orders" | "answerStatus">> & Pick<IntakeSettings, "escalateTo"> {
  return { orders: settings.intake?.orders ?? "draft", answerStatus: settings.intake?.answerStatus ?? false, escalateTo: settings.intake?.escalateTo };
}

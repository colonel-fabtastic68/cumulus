"use client";

import { useMemo, useState } from "react";
import type { IntakeChannel, IntakeMessage } from "@/lib/types";
import { logMessage } from "@/lib/connectors";
import { useCollection, useStore } from "@/lib/store/provider";
import { pluralize } from "@/lib/format";
import { Button, Combobox, FormGrid, Modal, Segmented, TextArea, TextField, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded?: (message: IntakeMessage) => void;
}

/** Mounts the form only while open so every opening starts empty. */
export function LogMessageModal(props: Props) {
  if (!props.open) return null;
  return <LogMessageForm {...props} />;
}

const BODY: Record<IntakeChannel, { label: string; placeholder: string }> = {
  email: { label: "Email", placeholder: "Paste the email" },
  phone: { label: "What the caller asked for", placeholder: "Item codes or names with quantities, or the order they asked about" },
  sms: { label: "Text", placeholder: "Paste the text" },
  manual: { label: "Message", placeholder: "Paste or type what they asked for" },
};

function LogMessageForm({ open, onClose, onAdded }: Props) {
  const store = useStore();
  const toast = useToast();
  const customers = useCollection("customers");
  const suppliers = useCollection("suppliers");
  const [channel, setChannel] = useState<IntakeChannel>("email");
  const [from, setFrom] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(
    () => [...customers.filter((c) => !c.erasedAt).map((c) => ({ value: c.name, label: c.name, description: c.company ?? "Customer" })), ...suppliers.map((s) => ({ value: s.name, label: s.name, description: "Supplier" }))].sort((a, b) => a.label.localeCompare(b.label)),
    [customers, suppliers],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await logMessage(store, { channel, from, fromAddress, subject: channel === "email" ? subject : undefined, body });
      const read = message.lines?.length ?? 0;
      toast(read ? `Read ${pluralize(read, "line")} from the message` : "Added. No item lines were found in it.", "success");
      onAdded?.(message);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a message"
      subtitle="Paste an email or a text, or type what a caller asked for. It is read against your items and orders the way a connected channel's messages are."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!body.trim()}>
            Add and read
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          value={channel}
          onChange={setChannel}
          options={[
            { value: "email", label: "Email" },
            { value: "phone", label: "Call" },
            { value: "sms", label: "Text" },
            { value: "manual", label: "Other" },
          ]}
        />
        <FormGrid cols={2}>
          <Combobox label="From" hint="(optional)" value={from} onChange={setFrom} onCreate={setFrom} createLabel={(q) => `Use “${q}”`} placeholder="Customer or supplier" options={people} />
          <TextField label={channel === "email" ? "Their email address" : "Their email or number"} hint="(optional)" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} autoComplete="off" help="Matched to a customer or supplier record when it is on one." />
        </FormGrid>
        {channel === "email" && <TextField label="Subject" hint="(optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />}
        <TextArea label={BODY[channel].label} value={body} onChange={(e) => setBody(e.target.value)} placeholder={BODY[channel].placeholder} rows={9} autoFocus />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}

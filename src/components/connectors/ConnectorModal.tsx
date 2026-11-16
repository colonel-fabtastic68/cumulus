"use client";

import { useState } from "react";
import type { Connector, ConnectorKind, ConnectorTopic, VoiceLine } from "@/lib/types";
import { ANSWER_LABEL, MAIL_LABEL, TOPICS_FOR, TOPIC_LABEL, defaultGreeting, saveConnector, type ConnectorInput } from "@/lib/connectors";
import { useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Button, Checkbox, FormGrid, Modal, Select, TextArea, TextField, Toggle, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ConnectorKind;
  /** Pass a connector to edit it; omit to add one. */
  connector?: Connector | null;
  /** The phone line's number, offered as the text line's number so the business keeps one. */
  phoneNumber?: string;
}

/** Mounts the form only while open so every opening starts from the channel as stored. */
export function ConnectorModal(props: Props) {
  if (!props.open) return null;
  return <ConnectorForm key={props.connector?.id ?? `new-${props.kind}`} {...props} />;
}

const TITLE: Record<ConnectorKind, { add: string; edit: string; subtitle: string; save: string }> = {
  email: { add: "Add an inbox", edit: "Edit inbox", subtitle: "Mail sent to this address is read for orders and questions.", save: "Add inbox" },
  phone: { add: "Set up the phone line", edit: "Phone line", subtitle: "Strato answers, works out what the caller needs and looks it up in cumulusOS.", save: "Save phone line" },
  sms: { add: "Set up texting", edit: "Text line", subtitle: "Texts to this number are read the moment they arrive.", save: "Save text line" },
};

const ANSWER_HELP: Record<VoiceLine["answer"], string> = {
  always: "Strato picks up every call first.",
  after_hours: "The team's phones ring during business hours. Strato takes the calls outside them.",
  no_answer: "Calls ring the team first and go to Strato when nobody picks up.",
};

const MAIL_HELP: Record<NonNullable<Connector["mail"]>, string> = {
  google: "You sign in to the mailbox once so cumulusOS can read new mail.",
  microsoft: "You sign in to the mailbox once so cumulusOS can read new mail.",
  forward: "You add a forwarding rule in your mail service, so a copy of each message reaches cumulusOS.",
};

function ConnectorForm({ open, onClose, kind, connector, phoneNumber }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { companyName } = useSettings();
  const copy = TITLE[kind];

  const [address, setAddress] = useState(connector?.address ?? (kind === "sms" ? (phoneNumber ?? "") : ""));
  const [name, setName] = useState(connector?.name ?? "");
  const [topics, setTopics] = useState<ConnectorTopic[]>(connector?.topics ?? TOPICS_FOR[kind].filter((t) => t !== "supplier"));
  const [replies, setReplies] = useState<NonNullable<Connector["replies"]>>(connector?.replies ?? "draft");
  const [mail, setMail] = useState<NonNullable<Connector["mail"]>>(connector?.mail ?? "google");
  const [unknownSenders, setUnknownSenders] = useState<NonNullable<Connector["unknownSenders"]>>(connector?.unknownSenders ?? "review");
  const [answer, setAnswer] = useState<VoiceLine["answer"]>(connector?.voice?.answer ?? "after_hours");
  const [opens, setOpens] = useState(connector?.voice?.hours?.open ?? "09:00");
  const [closes, setCloses] = useState(connector?.voice?.hours?.close ?? "17:00");
  const [days, setDays] = useState<"weekdays" | "every_day">(connector?.voice?.hours?.days ?? "weekdays");
  const [greeting, setGreeting] = useState(connector?.voice?.greeting ?? defaultGreeting(companyName));
  const [voiceId, setVoiceId] = useState(connector?.voice?.voiceId ?? "");
  const [transferTo, setTransferTo] = useState(connector?.voice?.transferTo ?? "");
  const [keepTranscripts, setKeepTranscripts] = useState(connector?.voice?.keepTranscripts ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTopic = (topic: ConnectorTopic, on: boolean) => setTopics((cur) => (on ? [...cur, topic] : cur.filter((t) => t !== topic)));
  const hoursWrong = kind === "phone" && answer === "after_hours" && closes <= opens;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const input: ConnectorInput = {
      kind,
      address,
      name,
      topics,
      replies,
      mail,
      unknownSenders,
      voice: kind === "phone" ? { answer, hours: { open: opens, close: closes, days }, greeting, voiceId, transferTo, keepTranscripts } : undefined,
    };
    try {
      await saveConnector(store, user, input, connector?.id);
      toast(connector ? "Saved" : kind === "email" ? `Added ${address.trim().toLowerCase()}` : kind === "phone" ? "Phone line saved" : "Text line saved", "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const topicBoxes = (
    <div>
      <div className="mb-1.5 text-[13px] text-text">{kind === "email" ? "Read this inbox for" : kind === "phone" ? "Callers can" : "Customers can text to"}</div>
      <div className="flex flex-col gap-1.5">
        {TOPICS_FOR[kind].map((t) => (
          <Checkbox key={t} label={TOPIC_LABEL[t]} checked={topics.includes(t)} onChange={(on) => toggleTopic(t, on)} />
        ))}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={kind === "phone" ? "lg" : "md"}
      title={connector ? copy.edit : copy.add}
      subtitle={copy.subtitle}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!address.trim() || topics.length === 0 || hoursWrong}>
            {connector ? "Save changes" : copy.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === "email" && (
          <>
            <FormGrid cols={2}>
              <TextField label="Email address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="orders@yourcompany.com" autoFocus={!connector} autoComplete="off" />
              <TextField label="Name" hint="(optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Orders" />
            </FormGrid>
            <Select label="Mail service" value={mail} onChange={(e) => setMail(e.target.value as typeof mail)} options={Object.entries(MAIL_LABEL).map(([value, label]) => ({ value, label }))} help={MAIL_HELP[mail]} />
            {topicBoxes}
            <Select
              label="Replies"
              value={replies}
              onChange={(e) => setReplies(e.target.value as typeof replies)}
              options={[
                { value: "draft", label: "Draft each reply for a person to send" },
                { value: "send", label: "Send routine replies and copy the team" },
              ]}
            />
          </>
        )}

        {kind === "phone" && (
          <>
            <FormGrid cols={2}>
              <TextField label="Business phone number" type="tel" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Area code and number" autoFocus={!connector} autoComplete="off" />
              <TextField label="Name" hint="(optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main line" />
            </FormGrid>
            <Select label="Strato answers" value={answer} onChange={(e) => setAnswer(e.target.value as typeof answer)} options={Object.entries(ANSWER_LABEL).map(([value, label]) => ({ value, label }))} help={ANSWER_HELP[answer]} />
            {answer === "after_hours" && (
              <FormGrid cols={3}>
                <TextField label="Opens" type="time" value={opens} onChange={(e) => setOpens(e.target.value)} />
                <TextField label="Closes" type="time" value={closes} onChange={(e) => setCloses(e.target.value)} error={hoursWrong ? "Before opening time" : undefined} />
                <Select
                  label="Days"
                  value={days}
                  onChange={(e) => setDays(e.target.value as typeof days)}
                  options={[
                    { value: "weekdays", label: "Monday to Friday" },
                    { value: "every_day", label: "Every day" },
                  ]}
                />
              </FormGrid>
            )}
            <TextArea label="Greeting" value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={3} help="Callers hear this first. It says they have reached an assistant, so nobody thinks it is a person." />
            {topicBoxes}
            <FormGrid cols={2}>
              <TextField label="Hand callers to a person at" hint="(optional)" type="tel" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="Area code and number" help="A caller can ask for a person at any point." />
              <TextField label="ElevenLabs voice ID" hint="(optional)" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} autoComplete="off" help="From your ElevenLabs voice library, to answer in a voice you chose. Empty uses the standard voice." />
            </FormGrid>
            <Toggle label="Keep a transcript of every call" help="Saved with the call under Intake." checked={keepTranscripts} onChange={setKeepTranscripts} />
          </>
        )}

        {kind === "sms" && (
          <>
            <FormGrid cols={2}>
              <TextField label="Mobile number" type="tel" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Area code and number" autoFocus={!connector} autoComplete="off" help={phoneNumber ? "The phone line's number keeps calls and texts on one number." : undefined} />
              <TextField label="Name" hint="(optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main line" />
            </FormGrid>
            <Select
              label="Replies"
              value={replies}
              onChange={(e) => setReplies(e.target.value as typeof replies)}
              options={[
                { value: "send", label: "Reply right away" },
                { value: "draft", label: "Draft each reply for a person to send" },
              ]}
            />
            {topicBoxes}
            <Select
              label="Texts from a number that is not on a customer record"
              value={unknownSenders}
              onChange={(e) => setUnknownSenders(e.target.value as typeof unknownSenders)}
              options={[
                { value: "review", label: "Hold for a person" },
                { value: "answer", label: "Answer, and ask who they are" },
              ]}
            />
            <p className="text-[12px] text-text-tertiary">US carriers require a business texting number to be registered before it can send messages.</p>
          </>
        )}

        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}

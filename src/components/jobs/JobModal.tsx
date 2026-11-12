"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Job, JobAssignee } from "@/lib/types";
import { createJob, updateJob } from "@/lib/jobs";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Button, Combobox, FormGrid, IconButton, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pass a job to edit it; omit to open a new one. */
  job?: Job | null;
  onSaved?: (job: Job) => void;
}

/** Mounts the form only while open so every opening starts from the job as stored. */
export function JobModal(props: Props) {
  if (!props.open) return null;
  return <JobForm key={props.job?.id ?? "new"} {...props} />;
}

interface CrewRow extends JobAssignee {
  key: number;
}

function JobForm({ open, onClose, job, onSaved }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const customers = useCollection("customers");
  const members = useCollection("members");
  const [name, setName] = useState(job?.name ?? "");
  const [customer, setCustomer] = useState(job?.customer ?? "");
  const [startOn, setStartOn] = useState(job?.startOn ?? "");
  const [dueOn, setDueOn] = useState(job?.dueOn ?? "");
  const [budget, setBudget] = useState(job?.budget !== undefined ? String(job.budget) : "");
  const [note, setNote] = useState(job?.note ?? "");
  const [crew, setCrew] = useState<CrewRow[]>(() => (job?.crew ?? []).map((c, i) => ({ ...c, key: i })));
  const [nextKey, setNextKey] = useState(job?.crew?.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerOptions = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.name, label: c.name, description: c.company })), [customers]);
  const record = customers.find((c) => c.name.toLowerCase() === customer.trim().toLowerCase());
  const datesWrong = !!startOn && !!dueOn && dueOn < startOn;
  const budgetWrong = budget.trim() !== "" && !(Number(budget) >= 0);
  const offTeam = members.filter((m) => m.status === "active" && !crew.some((c) => c.memberId === m.id));

  const addRow = (row: JobAssignee) => {
    setCrew((cur) => [...cur, { ...row, key: nextKey }]);
    setNextKey((k) => k + 1);
  };
  const patchRow = (key: number, patch: Partial<JobAssignee>) => setCrew((cur) => cur.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const submit = async () => {
    if (!name.trim()) return setError("Give the job a name");
    if (datesWrong) return setError("The due date is before the start date");
    setBusy(true);
    setError(null);
    const input = {
      name,
      customer: customer.trim() || undefined,
      customerId: record?.id,
      startOn: startOn || undefined,
      dueOn: dueOn || undefined,
      budget: budget.trim() === "" ? undefined : Number(budget),
      note,
      crew: crew.map(({ memberId, name: n, role, contact }) => ({ memberId, name: n, role, contact })),
    };
    try {
      const saved = job ? await updateJob(store, user, job.id, input) : await createJob(store, user, input);
      toast(job ? `Saved ${saved.number}` : `Opened ${saved.number}: ${saved.name}`, "success");
      onSaved?.(saved);
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
      title={job ? `Edit ${job.number}` : "New job"}
      subtitle="A job groups the orders, purchases and production that belong to one piece of work."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!name.trim() || datesWrong || budgetWrong}>
            {job ? "Save changes" : "Open job"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormGrid cols={2}>
          <TextField label="Job name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smith garage fit-out" autoFocus={!job} />
          <Combobox label="Customer" hint="(optional)" value={customer} onChange={setCustomer} onCreate={setCustomer} createLabel={(q) => `Use “${q}”`} placeholder="Type a customer name" options={customerOptions} />
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Start" hint="(optional)" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          <TextField label="Due" hint="(optional)" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} error={datesWrong ? "Before the start date" : undefined} />
          <TextField label="Budget" hint="(optional)" type="number" min={0} step="any" prefix="$" value={budget} onChange={(e) => setBudget(e.target.value)} error={budgetWrong ? "Enter an amount" : undefined} help="Expected cost, for the budget bar" />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-text">People on the job</span>
            <div className="flex items-center gap-2">
              {offTeam.length > 0 && (
                <Select
                  aria-label="Add a team member"
                  value=""
                  onChange={(e) => {
                    const m = members.find((x) => x.id === e.target.value);
                    if (m) addRow({ memberId: m.id, name: m.name, contact: m.email || undefined });
                  }}
                  placeholder="Add from the team"
                  options={offTeam.map((m) => ({ value: m.id, label: m.name }))}
                  containerClassName="w-48"
                  className="text-text"
                />
              )}
              <Button size="sm" variant="plain" icon={<Plus />} onClick={() => addRow({ name: "" })}>
                Add contractor
              </Button>
            </div>
          </div>
          <div className="rounded-[var(--radius)] border border-border">
            {crew.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12.5px] text-text-tertiary">Nobody assigned yet. Add people from the team, or outside contractors and installers by name.</div>
            ) : (
              crew.map((c) => (
                <div key={c.key} className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_32px] sm:items-start">
                  <TextField aria-label="Name" value={c.name} onChange={(e) => patchRow(c.key, { name: e.target.value })} placeholder="Name" disabled={!!c.memberId} />
                  <TextField aria-label="Role" value={c.role ?? ""} onChange={(e) => patchRow(c.key, { role: e.target.value })} placeholder="Role, e.g. Installer" />
                  <TextField aria-label="Phone or email" value={c.contact ?? ""} onChange={(e) => patchRow(c.key, { contact: e.target.value })} placeholder="Phone or email" />
                  <div className="flex justify-end sm:justify-center">
                    <IconButton variant="plain" size="md" onClick={() => setCrew((cur) => cur.filter((x) => x.key !== c.key))} aria-label={`Remove ${c.name || "this person"}`} className="text-text-tertiary hover:text-critical">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Scope, access, anything the crew should know" />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}

"use client";

import type { IntakeSettings } from "@/lib/types";
import { intakeRules } from "@/lib/connectors";
import { useCollection, useSettings } from "@/lib/store/provider";
import { useSaveSettings } from "@/components/workspace/settings/useSaveSettings";
import { Card, CardHeader, Select, Toggle, useToast } from "@/components/ui";

/** The rules every channel follows once a message has been read. Each change saves on its own. */
export function HandlingCard({ canWrite }: { canWrite: boolean }) {
  const settings = useSettings();
  const members = useCollection("members");
  const save = useSaveSettings();
  const toast = useToast();
  const rules = intakeRules(settings);
  const team = members.filter((m) => m.status === "active").sort((a, b) => a.name.localeCompare(b.name));

  const change = (patch: Partial<IntakeSettings>) => {
    void save({ intake: { ...settings.intake, ...patch } }).catch((e) => toast(e instanceof Error ? e.message : String(e), "critical"));
  };

  return (
    <Card>
      <CardHeader title="What happens to a message" subtitle="The same rules for every inbox, call and text." />
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 @3xl:grid-cols-2">
        <Select
          label="A new order"
          value={rules.orders}
          disabled={!canWrite}
          onChange={(e) => change({ orders: e.target.value as IntakeSettings["orders"] })}
          options={[
            { value: "draft", label: "Waits for a person to approve it" },
            { value: "auto", label: "Is created when the customer is known and every line matched" },
          ]}
          help="An order with a line that matched no item always waits for a person."
        />
        <Select
          label="What Strato cannot handle goes to"
          value={rules.escalateTo ?? ""}
          disabled={!canWrite}
          onChange={(e) => change({ escalateTo: e.target.value || undefined })}
          options={[{ value: "", label: "Everyone on the team" }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
        />
        <Toggle label="Answer where an order stands" help="What shipped, what is still open and tracking numbers, answered from the order record without waiting for a person." checked={rules.answerStatus} disabled={!canWrite} onChange={(answerStatus) => change({ answerStatus })} />
      </div>
    </Card>
  );
}

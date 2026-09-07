"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { buildSeed } from "@/lib/seed";
import { nowIso } from "@/lib/utils";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Banner, Button, CloudMark, Select, TextField } from "@/components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "MXN"];

/** First-run setup for a fresh workspace: name the company, pick a currency. */
export function Onboarding() {
  const store = useStore();
  const settings = useSettings();
  const members = useCollection("members");
  const user = useCurrentUser();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(settings.currency || "USD");
  const [busy, setBusy] = useState<"save" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the company a name.");
    setBusy("save");
    setError(null);
    try {
      await store.batch([
        { op: "patch", collection: "settings", id: "default", patch: { companyName: name.trim(), currency, updatedAt: nowIso() } },
        {
          op: "put",
          collection: "activity",
          doc: { id: `act_setup_${Date.now().toString(36)}`, type: "settings.updated", message: `${user.name} set up ${name.trim()}`, actorId: user.id, actorName: user.name, createdAt: nowIso() },
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const loadDemo = async () => {
    setBusy("demo");
    setError(null);
    try {
      const demo = buildSeed();
      // Keep the real accounts; the demo teammates are replaced by the people actually here.
      await store.replaceAll({ ...demo, members: members.length ? members : demo.members });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md p-6">
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary text-text-inverse">
          <CloudMark className="h-5 w-5" />
        </span>
        <h1 className="text-[16px] font-[650]">Set up your company</h1>
        <p className="mt-1 text-[13px] text-text-secondary">This workspace is empty. Name it, pick a currency, and you can start adding items or import a spreadsheet.</p>
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <TextField label="Company name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Manufacturing" autoFocus required />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          {error && <Banner tone="critical">{error}</Banner>}
          <Button type="submit" variant="primary" fullWidth loading={busy === "save"} disabled={busy !== null}>
            Create workspace
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-text-tertiary">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button fullWidth icon={<Sparkles />} onClick={loadDemo} loading={busy === "demo"} disabled={busy !== null}>
          Explore with sample data instead
        </Button>
        <p className="mt-2 text-center text-[12px] text-text-tertiary">Loads the Halcyon Audio demo (six months of history). You can clear it later from Settings → Data.</p>
      </div>
    </div>
  );
}

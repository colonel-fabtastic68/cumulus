"use client";

import { useState } from "react";
import { ArrowRight, Download, ExternalLink, Plug, RefreshCw, Unplug } from "lucide-react";
import type { Integration, IntegrationSettings } from "@/lib/types";
import { Badge, Banner, Button, ConfirmDialog, DescriptionList, Modal, StatusBadge, TextField, Toggle, useToast } from "@/components/ui";
import { useLocations } from "@/lib/locations";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { nowIso } from "@/lib/utils";
import { defaultSettings, type IntegrationDef } from "./catalog";
import { IntegrationMark } from "./IntegrationCard";

/** Gate: mounts the form only while open so its state resets per platform. */
export function IntegrationSetupModal({ open, onClose, def, integration }: { open: boolean; onClose: () => void; def?: IntegrationDef; integration?: Integration }) {
  if (!open || !def) return null;
  return <SetupForm key={def.id} def={def} integration={integration} onClose={onClose} />;
}

function SetupForm({ def, integration, onClose }: { def: IntegrationDef; integration?: Integration; onClose: () => void }) {
  const { mode } = useSession();
  const user = useCurrentUser();
  const canManage = user.role === "owner" || user.role === "admin";
  const connected = integration?.status === "connected" || integration?.status === "error";
  const live = def.kind !== "roadmap";

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <IntegrationMark def={def} size={24} />
          {connected ? def.name : `Connect ${def.name}`}
          <StatusBadge status={integration?.status ?? "not_connected"} />
        </span>
      }
      subtitle={live ? (def.kind === "carrier" ? "Rates, labels and tracking for the carriers on your account." : "Credentials are verified with the platform and kept on the server, never in the browser.") : "On the roadmap. Save your details now and use the CSV export until it ships."}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-4">
        {!live ? (
          <RoadmapForm def={def} integration={integration} onClose={onClose} />
        ) : mode !== "firestore" ? (
          <Banner tone="info" title="Live connections need the hosted version">
            This install runs in local mode with nothing on a server, so there is nowhere safe to keep {def.name} credentials. Sign in to a hosted workspace (Firestore mode) to connect. {def.export ? "A CSV export imports in the meantime." : ""}
          </Banner>
        ) : !canManage ? (
          <Banner tone="info">Only workspace owners and admins can connect or change {def.name}.</Banner>
        ) : connected && integration ? (
          <ConnectedPanel def={def} integration={integration} onClose={onClose} />
        ) : (
          <ConnectForm def={def} integration={integration} onClose={onClose} />
        )}
        {def.export && (!live || mode !== "firestore" || !connected) && <CsvFallback def={def} />}
      </div>
    </Modal>
  );
}

function SetupSteps({ def }: { def: IntegrationDef }) {
  if (def.setup.steps.length === 0) return null;
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-text">Where the credentials come from</h4>
        {def.setup.docsUrl && (
          <a href={def.setup.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
            {def.name} docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] text-text-secondary">
        {def.setup.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function SettingsToggles({ def, value, onChange, disabled }: { def: IntegrationDef; value: IntegrationSettings; onChange: (v: IntegrationSettings) => void; disabled?: boolean }) {
  const locations = useLocations();
  if (!def.settings?.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {def.settings.map((s) => (
        <Toggle key={s.key} label={s.label} help={s.help} checked={value[s.key] === true} onChange={(v) => onChange({ ...value, [s.key]: v })} disabled={disabled} />
      ))}
      {locations.length > 1 && (
        <label className="flex flex-col gap-1 text-[12.5px]">
          <span className="font-medium text-text">Location that mirrors the store</span>
          <select className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[13px]" value={value.locationId ?? ""} onChange={(e) => onChange({ ...value, locationId: e.target.value || undefined })} disabled={disabled}>
            <option value="">Whole company (all locations)</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-text-tertiary">Stock pushed out and counts accepted in use this location&apos;s quantity.</span>
        </label>
      )}
    </div>
  );
}

function ConnectForm({ def, integration, onClose }: { def: IntegrationDef; integration?: Integration; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(def.fields.map((f) => [f.key, integration?.config?.[f.key] ?? ""])));
  const [settings, setSettings] = useState<IntegrationSettings>(() => ({ ...defaultSettings(def), ...(integration?.settings ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = def.fields.every((f) => f.optional || values[f.key]?.trim());

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ integration: Integration }>(`/api/integrations/${def.id}/connect`, { credentials: values, settings });
      toast(res.integration.lastError ? `${def.name} connected, with a warning: ${res.integration.lastError}` : `${def.name} connected`, res.integration.lastError ? "default" : "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SetupSteps def={def} />
      <div className="flex flex-col gap-3">
        {def.fields.map((f) => (
          <TextField key={f.key} label={f.label} hint={f.optional ? "(optional)" : undefined} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} help={f.help} />
        ))}
      </div>
      {def.settings && (
        <div>
          <div className="mb-2 text-[13px] font-semibold text-text">What to sync</div>
          <SettingsToggles def={def} value={settings} onChange={setSettings} />
        </div>
      )}
      {error && <Banner tone="critical">{error}</Banner>}
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plug />} onClick={() => void connect()} loading={busy} disabled={!complete}>
          Connect {def.name}
        </Button>
      </div>
    </>
  );
}

function ConnectedPanel({ def, integration, onClose }: { def: IntegrationDef; integration: Integration; onClose: () => void }) {
  const api = useApi();
  const store = useStore();
  const toast = useToast();
  const [settings, setSettings] = useState<IntegrationSettings>(() => ({ ...defaultSettings(def), ...(integration.settings ?? {}) }));
  const [busy, setBusy] = useState<"sync" | "save" | "disconnect" | "push" | "reconnect" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical" | "info"; text: string } | null>(integration.lastError ? { tone: "critical", text: integration.lastError } : null);
  const dirty = JSON.stringify(settings) !== JSON.stringify({ ...defaultSettings(def), ...(integration.settings ?? {}) });

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await fn();
      setMessage({ tone: "success", text });
    } catch (e) {
      setMessage({ tone: "critical", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(null);
    }
  };

  const sync = () =>
    run("sync", async () => {
      const res = await api<{ summary: string; orders?: { warnings: string[] } }>(`/api/integrations/${def.id}/sync`, {});
      const warn = res.orders?.warnings?.length ? ` · ${res.orders.warnings.slice(0, 2).join("; ")}` : "";
      return `Synced: ${res.summary}${warn}`;
    });

  const push = () =>
    run("push", async () => {
      const res = await api<{ results: Record<string, { pushed: number; skipped: number; created?: number; linked?: number; errors: string[] }> }>("/api/integrations/push-stock", {});
      const r = res.results[def.id];
      if (!r) return "Pushing is off for this connection; turn on “Push stock levels out” or “Push new items” and save.";
      const parts = [`${r.pushed} stock level${r.pushed === 1 ? "" : "s"} pushed`];
      if (r.created) parts.push(`${r.created} new ${integration.settings?.publishProducts ? "live" : "draft"} product${r.created === 1 ? "" : "s"} created`);
      if (r.linked) parts.push(`${r.linked} linked by SKU`);
      if (r.skipped) parts.push(`${r.skipped} skipped`);
      return `${parts.join(", ")}${r.errors.length ? ` · ${r.errors.slice(0, 2).join("; ")}` : ""}`;
    });

  // Re-verifies with the stored credentials and registers the webhooks again (settings changes need this too).
  const reconnect = () =>
    run("reconnect", async () => {
      const res = await api<{ integration: Integration }>(`/api/integrations/${def.id}/connect`, { credentials: {}, settings });
      const hooks = res.integration.webhooks?.length ?? 0;
      return res.integration.lastError ? `Reconnected with a warning: ${res.integration.lastError}` : `Reconnected · ${hooks} webhook${hooks === 1 ? "" : "s"} registered`;
    });

  const save = () =>
    run("save", async () => {
      await store.patch("integrations", def.id, { settings: { ...(integration.settings ?? {}), ...settings } });
      return "Settings saved. Press Reconnect to update the webhooks to match.";
    });

  const disconnect = async () => {
    setConfirm(false);
    await run("disconnect", async () => {
      await api(`/api/integrations/${def.id}/disconnect`, {});
      toast(`${def.name} disconnected`, "success");
      onClose();
      return "Disconnected";
    });
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (integration.config?.shop) rows.push({ label: "Store", value: <span className="font-mono text-[12px]">{integration.config.shop}</span> });
  if (integration.config?.siteUrl) rows.push({ label: "Site", value: <span className="font-mono text-[12px]">{integration.config.siteUrl}</span> });
  if (integration.config?.shopName || integration.config?.siteName) rows.push({ label: "Name", value: integration.config.shopName ?? integration.config.siteName });
  if (integration.config?.account) rows.push({ label: "Account", value: integration.config.account });
  if (integration.config?.mode) rows.push({ label: "Key", value: <Badge tone={integration.config.mode === "test" ? "attention" : "success"}>{integration.config.mode === "test" ? "Test" : "Live"}</Badge> });
  if (integration.config?.currency) rows.push({ label: "Currency", value: integration.config.currency });
  rows.push({ label: "Connected", value: integration.connectedAt ? <span title={formatDateTime(integration.connectedAt)}>{formatRelative(integration.connectedAt)}</span> : "—" });
  if (def.kind === "channel") rows.push({ label: "Last sync", value: integration.lastSyncAt ? <span title={formatDateTime(integration.lastSyncAt)}>{formatRelative(integration.lastSyncAt)}{integration.lastSyncSummary ? ` · ${integration.lastSyncSummary}` : ""}</span> : <span className="text-text-tertiary">Not yet</span> });
  rows.push({ label: "Webhooks", value: integration.webhooks?.length ? `${integration.webhooks.length} registered (${integration.webhooks.map((w) => w.topic).join(", ")})` : <span className="text-text-tertiary">None</span> });

  return (
    <>
      <DescriptionList rows={rows} />
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      {def.kind === "channel" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<RefreshCw />} onClick={() => void sync()} loading={busy === "sync"} disabled={busy !== null}>
            Sync now
          </Button>
          <Button icon={<ArrowRight />} onClick={() => void push()} loading={busy === "push"} disabled={busy !== null}>
            Push to store
          </Button>
        </div>
      )}
      {def.kind === "carrier" && (
        <Banner tone="info">
          Ship an order from the Orders page to compare rates and buy a label. Set the ship-from address and default parcel under{" "}
          <a href="/settings" className="text-accent hover:underline">
            Settings → Shipping and scanning
          </a>
          .
        </Banner>
      )}
      {def.settings && (
        <div>
          <div className="mb-2 text-[13px] font-semibold text-text">What to sync</div>
          <SettingsToggles def={def} value={settings} onChange={setSettings} />
          {dirty && (
            <Button size="sm" variant="primary" className="mt-3" onClick={() => void save()} loading={busy === "save"}>
              Save settings
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Plug />} onClick={() => void reconnect()} loading={busy === "reconnect"} disabled={busy !== null}>
            Reconnect
          </Button>
          <Button size="sm" variant="plain" onClick={() => setReplace((v) => !v)}>
            {replace ? "Keep current credentials" : "Replace credentials"}
          </Button>
        </div>
        <Button size="sm" icon={<Unplug />} className="text-critical" onClick={() => setConfirm(true)} disabled={busy !== null}>
          Disconnect
        </Button>
      </div>
      {replace && <ConnectForm def={def} integration={integration} onClose={onClose} />}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void disconnect()} destructive title={`Disconnect ${def.name}?`} confirmLabel="Disconnect" loading={busy === "disconnect"} message={<>The stored credentials are deleted and the webhooks removed. Items, orders and shipments already in Cumulus stay as they are.</>} />
    </>
  );
}

function RoadmapForm({ def, integration, onClose }: { def: IntegrationDef; integration?: Integration; onClose: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = user.role !== "viewer";
  const field = def.fields[0];
  const [value, setValue] = useState(field ? (integration?.config?.[field.key] ?? "") : "");
  const [saving, setSaving] = useState(false);
  const dirty = !!field && value.trim() !== (integration?.config?.[field.key] ?? "");

  const save = async () => {
    if (!field) return;
    setSaving(true);
    try {
      const config: Record<string, string> = { ...(integration?.config ?? {}) };
      if (value.trim()) config[field.key] = value.trim();
      else delete config[field.key];
      if (integration) await store.patch("integrations", def.id, { config });
      else await store.put("integrations", { id: def.id, status: "not_connected", config, createdAt: nowIso() });
      toast(`${def.name} details saved`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Banner tone="info" title="Live sync is on the roadmap">
        Cumulus does not talk to {def.name} yet. Nothing you enter here is sent anywhere; it is stored with the workspace so the connection is ready to switch on later.
      </Banner>
      {field && (
        <div className="flex items-end gap-2">
          <TextField label={field.label} placeholder={field.placeholder} value={value} onChange={(e) => setValue(e.target.value)} help={writable ? field.help : "Viewers cannot save integration details."} disabled={!writable} containerClassName="flex-1" />
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!writable || !dirty}>
            Save
          </Button>
        </div>
      )}
    </>
  );
}

function CsvFallback({ def }: { def: IntegrationDef }) {
  if (!def.export) return null;
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-[13px] font-semibold text-text">Without a connection: CSV export from {def.name}</h4>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">A product export imports in under a minute and updates existing items by SKU.</p>
        </div>
        <Button size="sm" href="/import" icon={<Download />} iconRight={<ArrowRight />}>
          Go to Import
        </Button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] text-text-secondary">
        {def.export.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-text-tertiary">Expected header row</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {def.export.headers.map((h) => (
          <code key={h} className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-text-secondary">
            {h}
          </code>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-text-tertiary">{def.export.note}</p>
    </div>
  );
}

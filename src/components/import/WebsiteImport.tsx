"use client";

import { useState } from "react";
import { Globe, Sparkles } from "lucide-react";
import type { ImportRow } from "@/lib/inventory";
import { importItems } from "@/lib/inventory";
import { Badge, Banner, Button, TextField, useToast } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store/provider";
import { formatMoney, pluralize } from "@/lib/format";
import { useSettings } from "@/lib/store/provider";

interface ScanResult {
  platform: "shopify" | "woocommerce" | "generic";
  site: string;
  rows: ImportRow[];
  namedAsSku: number;
  pagesScanned: number;
  warnings: string[];
  truncated: boolean;
}

const PLATFORM_LABEL = { shopify: "Shopify store", woocommerce: "WooCommerce store", generic: "website" };

const REFINE_PROMPT = `I just imported my catalog from my website. Help me fill in what the site could not tell you: for each item, suggest a category, a reasonable min and max stock level, and flag anything that looks like a duplicate or a variant of another item. Ask me for costs and quantities in batches so I can answer quickly.`;

/**
 * Paste a website, get the catalog: names, SKUs, prices, barcodes, images
 * and categories. Quantities and costs are never on a public site, so the
 * import leaves them blank and hands the rest to Strato.
 */
export function WebsiteImport({ onboarding }: { onboarding?: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const session = useSession();
  const api = useApi();
  const toast = useToast();
  const { open: openAgent } = useAgent();
  const { currency } = useSettings();
  const writable = canWrite(user);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"scan" | "import" | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);
  const hosted = session.mode === "firestore";

  const scan = async () => {
    setBusy("scan");
    setError(null);
    setResult(null);
    setDone(null);
    try {
      setResult(await api<ScanResult>("/api/import/website", { url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!result) return;
    setBusy("import");
    setError(null);
    try {
      const r = await importItems(store, user, result.rows.map((row) => ({ ...row, qty: undefined })));
      setDone({ created: r.created, updated: r.updated });
      toast(`Imported ${pluralize(r.created + r.updated, "item")} from ${result.site.replace(/^https?:\/\//, "")}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
          <Globe className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-text">{onboarding ? "Start from your website" : "Import from your website"}</h2>
            <Badge tone="attention">Beta</Badge>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-5 text-text-secondary">
            Paste your shop&apos;s address and cumulusOS reads the catalog: names, SKUs, prices, barcodes, images and categories. Quantities and costs are never on a public website, so they start blank — connect the store for live stock, and Strato can help fill in the rest.
          </p>
        </div>
      </div>

      {!hosted ? (
        <Banner tone="info" className="mt-4">
          Reading a website needs the hosted version. Upload a CSV below in the meantime.
        </Banner>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && busy === null) void scan();
          }}
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <TextField label="Website" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="shop.example.com" inputMode="url" autoComplete="off" containerClassName="flex-1" disabled={!writable || busy !== null} autoFocus={onboarding} />
          <Button type="submit" variant="primary" loading={busy === "scan"} disabled={!writable || !url.trim() || busy !== null}>
            {busy === "scan" ? "Reading your site…" : "Read my catalog"}
          </Button>
        </form>
      )}
      {busy === "scan" && <p className="mt-2 text-[12px] text-text-tertiary">Platform feeds take a few seconds; other sites are read page by page and can take a minute or two.</p>}
      {error && <Banner tone="critical" className="mt-4">{error}</Banner>}

      {result && !done && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-text">
            <Badge tone="success">{PLATFORM_LABEL[result.platform]}</Badge>
            <span className="font-medium">{pluralize(result.rows.length, "item")} found</span>
            <span className="text-text-secondary">
              · {result.pagesScanned} {result.platform === "generic" ? "pages read" : "feed page(s)"}
              {result.namedAsSku ? ` · ${result.namedAsSku} without a SKU (one is made from the name)` : ""}
              {result.truncated ? " · stopped at the limit" : ""}
            </span>
          </div>
          {result.warnings.map((w) => (
            <Banner key={w} tone="warning">
              {w}
            </Banner>
          ))}
          {result.rows.length > 0 && (
            <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface-subdued text-left text-[11.5px] uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-3 py-1.5">SKU</th>
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">Category</th>
                    <th className="px-3 py-1.5 text-right">Retail price</th>
                    <th className="px-3 py-1.5">Barcode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.slice(0, 8).map((r) => (
                    <tr key={r.sku}>
                      <td className="px-3 py-1.5 font-mono text-[11.5px] text-text">{r.sku}</td>
                      <td className="px-3 py-1.5 text-text">{r.name}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{r.category ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular text-text-secondary">{r.price !== undefined ? formatMoney(r.price, currency) : "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-[11.5px] text-text-secondary">{r.barcode ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 8 && <p className="px-3 py-1.5 text-[11.5px] text-text-tertiary">…and {result.rows.length - 8} more</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => setResult(null)} disabled={busy !== null}>
              Start over
            </Button>
            <Button variant="primary" onClick={() => void run()} loading={busy === "import"} disabled={!writable || result.rows.length === 0 || busy !== null}>
              Import {pluralize(result.rows.length, "item")}
            </Button>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-surface-subdued p-4">
          <p className="text-[13px] text-text">
            <span className="font-medium">{done.created} added, {done.updated} updated.</span> Quantities and costs are blank until you set them or connect the store.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Sparkles />} onClick={() => openAgent(REFINE_PROMPT, { send: false })}>
              Refine with Strato
            </Button>
            <Button href="/inventory">Open Inventory</Button>
            <Button href="/integrations">Connect the store</Button>
          </div>
        </div>
      )}
    </section>
  );
}

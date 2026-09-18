"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { Kbd, Modal } from "@/components/ui";
import { useCollection } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { SEARCH_GROUP_LABELS, searchWorkspace, type SearchHit, type SearchKind, type SearchPage } from "@/lib/search";
import { REPORT_TABS } from "@/components/reports/reportTabs";
import { INTEGRATIONS } from "@/components/workspace/integrations/catalog";
import { SETTINGS_SECTIONS } from "@/components/workspace/settings/sections";
import { NAV, NAV_SECONDARY } from "./nav";

/** Sidebar entries the search leaves out: Exports and everything under Strato. */
const EXCLUDED = ["/exports", "/strato"];

/** Words a page answers to besides its label. */
const PAGE_KEYWORDS: Record<string, string> = {
  "/home": "dashboard overview today",
  "/inventory": "items parts stock sku catalogue",
  "/receiving": "receipts deliveries receive purchase",
  "/transfers": "move stock between locations in transit",
  "/builds": "bill of materials assemblies builds",
  "/orders": "sales customers shipments ship fulfil",
  "/rmas": "rma returns inspections write-offs",
  "/suppliers": "vendors purchasing",
  "/reports": "kpi valuation dead stock seasonality",
  "/import": "spreadsheet csv upload mapping",
  "/integrations": "shopify woocommerce shippo easypost connections",
  "/team": "members invite roles users",
  "/activity": "log history audit who did what",
  "/settings": "company currency timezone preferences",
};

const PAGES: SearchPage[] = [
  ...[...NAV, ...NAV_SECONDARY]
    .flatMap((n) => (n.children ? n.children : [n]))
    .filter((n) => !EXCLUDED.some((x) => n.href === x || n.href.startsWith(x + "/")))
    .map((n) => ({ kind: "Page" as const, label: n.label, href: n.href, keywords: PAGE_KEYWORDS[n.href] })),
  { kind: "Page", label: "Account", href: "/account", keywords: "profile workspaces invites password sign out" },
  ...REPORT_TABS.map((t) => ({ kind: "Report" as const, label: t.label, href: `/reports?tab=${t.value}`, sub: "Report", keywords: "report" })),
  ...SETTINGS_SECTIONS.map((s) => ({ kind: "Setting" as const, label: s.title, href: `/settings#${s.id}`, sub: s.description, keywords: s.keywords })),
];

const INTEGRATION_KIND: Record<string, string> = { channel: "Sales channel", carrier: "Carrier", accounting: "Accounting", roadmap: "Roadmap" };

/**
 * ⌘K search over every sidebar page except Exports and Strato, and the records
 * behind them. Enter opens the highlighted result; with no results it hands
 * the query to Strato.
 */
export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const items = useCollection("items");
  const orders = useCollection("orders");
  const shipments = useCollection("shipments");
  const rmas = useCollection("rmas");
  const receipts = useCollection("receipts");
  const transfers = useCollection("transfers");
  const builds = useCollection("builds");
  const suppliers = useCollection("suppliers");
  const customers = useCollection("customers");
  const locations = useCollection("locations");
  const members = useCollection("members");
  const integrations = useCollection("integrations");
  const activity = useCollection("activity");
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const { open: openAgent } = useAgent();

  const integrationRows = useMemo(
    () =>
      INTEGRATIONS.map((def) => {
        const live = integrations.find((i) => i.id === def.id);
        const status = def.kind === "roadmap" ? "Coming soon" : live?.status === "connected" ? "Connected" : live?.status === "error" ? "Needs attention" : "Not connected";
        return { id: def.id, name: def.name, sub: `${status} · ${INTEGRATION_KIND[def.kind] ?? def.kind}` };
      }),
    [integrations],
  );

  const results = useMemo(
    () => searchWorkspace(q, { pages: PAGES, items, orders, shipments, rmas, receipts, transfers, builds, suppliers, customers, locations, members, integrations: integrationRows, activity }),
    [q, items, orders, shipments, rmas, receipts, transfers, builds, suppliers, customers, locations, members, integrationRows, activity],
  );

  const groups = useMemo(() => {
    const out: Array<{ kind: SearchKind; hits: Array<{ hit: SearchHit; index: number }> }> = [];
    results.forEach((hit, index) => {
      const last = out[out.length - 1];
      if (last && last.kind === hit.kind) last.hits.push({ hit, index });
      else out.push({ kind: hit.kind, hits: [{ hit, index }] });
    });
    return out;
  }, [results]);

  const go = (i: number) => {
    const r = results[i];
    if (r) {
      router.push(r.href);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="-m-5">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-text-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                if (results.length) go(idx);
                else if (q.trim()) {
                  openAgent(q);
                  onClose();
                }
              }
            }}
            placeholder="Search items, orders, suppliers, pages…"
            aria-label="Search the workspace"
            className="h-8 flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-tertiary"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-text-tertiary">
              {q.trim() ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent-soft px-2.5 py-1.5 text-accent"
                  onClick={() => {
                    openAgent(q);
                    onClose();
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Ask Strato: “{q}”
                </button>
              ) : (
                "Search items, BOMs, orders, shipments, returns, receiving, transfers, suppliers, locations, team, integrations, reports, settings and pages."
              )}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.kind} className="pb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-[550] uppercase tracking-[0.06em] text-text-tertiary">{SEARCH_GROUP_LABELS[g.kind]}</div>
                {g.hits.map(({ hit, index }) => (
                  <button
                    key={hit.kind + hit.key}
                    type="button"
                    ref={(el) => {
                      if (index === idx) el?.scrollIntoView({ block: "nearest" });
                    }}
                    onMouseEnter={() => setIdx(index)}
                    onClick={() => go(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-left text-[13px] ${index === idx ? "bg-surface-hover" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-text">{hit.label}</span>
                      {hit.sub && <span className="block truncate text-[12px] text-text-tertiary">{hit.sub}</span>}
                    </span>
                    {index === idx && <Kbd>↵</Kbd>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

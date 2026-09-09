"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, Page, Skeleton, Tabs } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { useItems, useSettings } from "@/lib/store/provider";
import { isLowStock } from "@/lib/inventory";
import {
  BackorderReport,
  ConsumptionReport,
  DEFAULT_REPORT_TAB,
  DeadStockReport,
  KpiReport,
  LowStockReport,
  REPORT_TABS,
  SeasonalityReport,
  ShelfLifeReport,
  ValuationReport,
  WriteOffsReport,
  isReportTab,
  reportTabLabel,
  type ReportTab,
} from "@/components/reports";

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsFallback />}>
      <ReportsView />
    </Suspense>
  );
}

/**
 * The active tab lives in local state and is mirrored to `?tab=` with
 * history.replaceState (no navigation, so back/forward and reloads land on the
 * same report). useSearchParams is read under the Suspense boundary above so
 * the static prerender does not bail out.
 */
function ReportsView() {
  const params = useSearchParams();
  const raw = params.get("tab");
  const urlTab: ReportTab = isReportTab(raw) ? raw : DEFAULT_REPORT_TAB;

  const [tab, setTab] = useState<ReportTab>(urlTab);
  // Re-sync when the URL changes underneath us, e.g. a link to /reports?tab=lowStock while already on the page.
  const [seenUrlTab, setSeenUrlTab] = useState<ReportTab>(urlTab);
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }

  const settings = useSettings();
  const items = useItems();
  const { open: openAgent, setPageContext } = useAgent();

  const lowCount = useMemo(() => items.filter(isLowStock).length, [items]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === tab) return;
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [tab]);

  useEffect(() => {
    setPageContext({ page: "Reports · " + reportTabLabel(tab) });
    return () => setPageContext({});
  }, [setPageContext, tab]);

  const tabs = useMemo(() => REPORT_TABS.map((t) => (t.value === "lowStock" && lowCount > 0 ? { ...t, count: lowCount } : t)), [lowCount]);

  return (
    <Page
      title="Reports"
      subtitle={`Reorder, valuation, ageing and usage across ${settings.companyName}. Every report exports to CSV and can be handed to Nimbus.`}
      wide
      secondaryActions={
        <Button icon={<Sparkles />} onClick={() => openAgent()}>
          Ask Nimbus
        </Button>
      }
    >
      <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-5" />
      {tab === "lowStock" && <LowStockReport />}
      {tab === "kpis" && <KpiReport />}
      {tab === "backorders" && <BackorderReport />}
      {tab === "valuation" && <ValuationReport />}
      {tab === "shelfLife" && <ShelfLifeReport />}
      {tab === "deadStock" && <DeadStockReport />}
      {tab === "consumption" && <ConsumptionReport />}
      {tab === "seasonality" && <SeasonalityReport />}
      {tab === "writeOffs" && <WriteOffsReport />}
    </Page>
  );
}

function ReportsFallback() {
  return (
    <Page title="Reports" wide>
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="mt-5 h-72 w-full" />
    </Page>
  );
}

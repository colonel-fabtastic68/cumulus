/** Tab keys for /reports. The key doubles as the `?tab=` query value. */
export type ReportTab = "lowStock" | "valuation" | "shelfLife" | "deadStock" | "consumption" | "seasonality" | "writeOffs";

export const REPORT_TABS: Array<{ value: ReportTab; label: string }> = [
  { value: "lowStock", label: "Low stock & reorder" },
  { value: "valuation", label: "Valuation" },
  { value: "shelfLife", label: "Shelf life" },
  { value: "deadStock", label: "Dead stock" },
  { value: "consumption", label: "Consumption" },
  { value: "seasonality", label: "Seasonality" },
  { value: "writeOffs", label: "Write-offs" },
];

export const DEFAULT_REPORT_TAB: ReportTab = "lowStock";

export function isReportTab(value: string | null | undefined): value is ReportTab {
  return REPORT_TABS.some((t) => t.value === value);
}

export function reportTabLabel(tab: ReportTab): string {
  return REPORT_TABS.find((t) => t.value === tab)?.label ?? "Reports";
}

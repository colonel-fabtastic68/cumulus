"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Page, Skeleton } from "@/components/ui";
import { InventoryList } from "@/components/inventory/InventoryList";
import { isInventoryView } from "@/components/inventory/inventoryFilters";

export default function InventoryPage() {
  return (
    <Suspense fallback={<InventoryFallback />}>
      <InventoryFromQuery />
    </Suspense>
  );
}

/**
 * Reads `?filter=low` and `?q=` to seed the list. Lives under a Suspense
 * boundary so the static prerender does not bail out on useSearchParams.
 * Keyed on the query string so a navigation with new params re-seeds the view.
 */
function InventoryFromQuery() {
  const params = useSearchParams();
  const filter = params.get("filter");
  const q = params.get("q") ?? "";
  return <InventoryList key={params.toString()} initialView={isInventoryView(filter) ? filter : "all"} initialQuery={q} />;
}

function InventoryFallback() {
  return (
    <Page title="Inventory" wide>
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="mt-4 h-72 w-full" />
    </Page>
  );
}

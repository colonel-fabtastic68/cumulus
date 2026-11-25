"use client";

import { ListPlus } from "lucide-react";
import type { Item } from "@/lib/types";
import { Banner, Button } from "@/components/ui";
import { buildBlocker } from "./buildUtils";

/**
 * Shown in the build and work order dialogs when the chosen item cannot be built yet:
 * says what is missing and links to where it is set up (the item's BOM tab).
 * Renders nothing for an item that is ready.
 */
export function BuildSetupNotice({ item }: { item: Item }) {
  const blocker = buildBlocker(item);
  if (!blocker) return null;

  if (blocker === "notActive") {
    return (
      <Banner
        tone="warning"
        title={`${item.sku} is ${item.status === "superseded" ? "superseded" : "inactive"}`}
        action={
          <Button size="sm" href={`/inventory/${item.id}`}>
            Open item
          </Button>
        }
      >
        {item.status === "superseded" ? "It was replaced by another item, so it is no longer built. Its item page shows the replacement." : "Only active items can be built. Reactivate it on its item page first."}
      </Banner>
    );
  }

  return (
    <Banner
      tone="warning"
      title={blocker === "noParts" ? `${item.sku} has no parts list yet` : `${item.sku} is not set up as an assembly`}
      action={
        <Button size="sm" variant="primary" icon={<ListPlus />} href={`/inventory/${item.id}?tab=bom`}>
          {blocker === "noParts" ? "Add parts" : "Set up parts list"}
        </Button>
      }
    >
      {blocker === "noParts"
        ? "Add the parts and sub-assemblies it is built from on its BOM tab, then build it."
        : "On its BOM tab, convert it to an assembly and add the parts it is built from. Then it can be built."}
    </Banner>
  );
}

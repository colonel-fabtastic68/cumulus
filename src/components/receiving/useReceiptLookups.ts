"use client";

import { useMemo } from "react";
import { useCollection, useItemsById } from "@/lib/store/provider";
import type { ReceiptLookups } from "./receiptUtils";

/** Live id -> record maps for items, suppliers and members. */
export function useReceiptLookups(): ReceiptLookups {
  const itemsById = useItemsById();
  const suppliers = useCollection("suppliers");
  const members = useCollection("members");
  return useMemo(
    () => ({
      itemsById,
      suppliersById: new Map(suppliers.map((s) => [s.id, s])),
      membersById: new Map(members.map((m) => [m.id, m])),
    }),
    [itemsById, suppliers, members],
  );
}

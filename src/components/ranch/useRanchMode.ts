"use client";

import { useCollection } from "@/lib/store/provider";
import { ranchModeOf, type RanchMode } from "@/lib/ranch/squareTruth";

/** Who keeps the ranch counts (Square, or cumulusOS with Square following), and whether Square is connected at all. */
export function useRanchMode(): { mode: RanchMode; squareConnected: boolean } {
  const square = useCollection("integrations").find((i) => i.id === "square");
  return { mode: ranchModeOf(square?.config), squareConnected: !!square && square.status !== "not_connected" };
}

"use client";

import { useCallback } from "react";
import type { OrderEmail } from "@/lib/types";
import { useApi } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useSettings } from "@/lib/store/provider";
import { useToast } from "@/components/ui";
import { ORDER_EMAIL_LABELS } from "@/lib/orderEmails";

const SKIPPED: Record<string, string> = { off: "That email is switched off under Settings → Notifications.", already: "That email already went out." };

/**
 * Sends an order email through the server. Automatic sends happen only when
 * the workspace has that notification on; the buttons on an order pass
 * `force`. Best effort: a mail problem is reported, never blocks the order.
 */
export function useOrderNotifier(): (kind: OrderEmail["kind"], orderId: string, opts?: { shipmentId?: string; force?: boolean }) => Promise<OrderEmail | null> {
  const api = useApi();
  const { mode } = useSession();
  const settings = useSettings();
  const toast = useToast();
  return useCallback(
    async (kind, orderId, opts = {}) => {
      const on = kind === "shipped" ? settings.notifications?.orderShipped === true : settings.notifications?.orderConfirmed === true;
      if (mode !== "firestore" || (!opts.force && !on)) return null;
      try {
        const res = await api<{ ok: true; sent?: OrderEmail; skipped?: string }>("/api/orders/notify", { orderId, kind, shipmentId: opts.shipmentId, force: opts.force });
        if (res.sent && !res.skipped) toast(`${ORDER_EMAIL_LABELS[kind]} emailed to ${res.sent.to}`, "success");
        else if (opts.force && res.skipped) toast(SKIPPED[res.skipped] ?? "Not sent.", "default");
        return res.sent ?? null;
      } catch (e) {
        toast(`${ORDER_EMAIL_LABELS[kind]} not sent: ${e instanceof Error ? e.message : String(e)}`, "critical");
        return null;
      }
    },
    [api, mode, settings.notifications, toast],
  );
}

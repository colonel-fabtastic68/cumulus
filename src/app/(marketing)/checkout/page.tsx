import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkout } from "@/components/marketing/Checkout";

export const metadata: Metadata = {
  title: "Founding Members checkout · Cumulus",
  description: "Join Cumulus as a founding member: $199 a month instead of $299, unlimited team users, every future version included.",
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <Checkout />
    </Suspense>
  );
}

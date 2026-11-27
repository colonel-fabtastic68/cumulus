import { Suspense } from "react";
import type { Metadata } from "next";
import { TwoStep } from "@/components/auth/TwoStep";

export const metadata: Metadata = { title: "Enter your sign-in code · cumulusOS" };

export default function TwoStepPage() {
  return (
    <Suspense>
      <TwoStep />
    </Suspense>
  );
}

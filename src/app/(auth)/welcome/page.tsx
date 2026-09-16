import { Suspense } from "react";
import type { Metadata } from "next";
import { Intake } from "@/components/auth/Intake";

export const metadata: Metadata = { title: "Welcome · cumulusOS" };

export default function WelcomePage() {
  return (
    <Suspense>
      <Intake />
    </Suspense>
  );
}

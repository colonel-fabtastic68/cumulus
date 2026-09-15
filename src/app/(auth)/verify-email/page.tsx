import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/VerifyEmail";

export const metadata: Metadata = { title: "Verify your email · cumulusOS" };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}

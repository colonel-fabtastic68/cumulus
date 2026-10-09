import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { requestInstanceDef } from "@/lib/server/runtime";

/** A bespoke instance names the tab after its own product. */
export async function generateMetadata(): Promise<Metadata> {
  const inst = await requestInstanceDef();
  return { title: `Reset your password · ${inst ? inst.brand.product : "cumulusOS"}` };
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

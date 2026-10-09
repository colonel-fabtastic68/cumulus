import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";
import { requestInstanceDef } from "@/lib/server/runtime";

/** A bespoke instance names the tab after its own product. */
export async function generateMetadata(): Promise<Metadata> {
  const inst = await requestInstanceDef();
  return { title: `Sign in · ${inst ? inst.brand.product : "cumulusOS"}` };
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

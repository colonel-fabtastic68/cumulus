import type { Metadata } from "next";
import { CodeWizard } from "@/components/labels/CodeWizard";

export const metadata: Metadata = { title: "New codes · cumulusOS" };

/** Making codes for items, a step at a time. Takes the whole window, like the guided setup. */
export default function NewCodesPage() {
  return <CodeWizard />;
}

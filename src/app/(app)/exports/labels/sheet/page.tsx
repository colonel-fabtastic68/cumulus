import type { Metadata } from "next";
import { LabelStudio } from "@/components/labels/LabelStudio";

export const metadata: Metadata = { title: "Label sheet · cumulusOS" };

/** The sheet designer: one kind of code across a sheet, for locations, suppliers, batches and a document's quantities. */
export default function LabelSheetPage() {
  return <LabelStudio />;
}

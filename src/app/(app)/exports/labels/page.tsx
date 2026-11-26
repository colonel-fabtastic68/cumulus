import type { Metadata } from "next";
import { LabelsHome } from "@/components/labels/LabelsHome";

export const metadata: Metadata = { title: "Labels & barcodes · cumulusOS" };

export default function LabelsPage() {
  return <LabelsHome />;
}

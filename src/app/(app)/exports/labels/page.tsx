import type { Metadata } from "next";
import { LabelStudio } from "@/components/labels/LabelStudio";

export const metadata: Metadata = { title: "Labels & barcodes · cumulusOS" };

export default function LabelsPage() {
  return <LabelStudio />;
}

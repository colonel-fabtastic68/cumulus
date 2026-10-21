import type { Metadata } from "next";
import { ScanPage } from "@/components/scan/ScanPage";

export const metadata: Metadata = { title: "Scan · cumulusOS" };

export default function Scan() {
  return <ScanPage />;
}

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { requestInstanceDef } from "@/lib/server/runtime";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", weight: "variable" });

const SHARED_METADATA: Metadata = {
  title: "cumulusOS",
  description: "Agentic, collaborative inventory management for small teams.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "cumulusOS", statusBarStyle: "default" },
};

/** A bespoke instance names and icons the tab after the client, with no cumulusOS manifest. */
export async function generateMetadata(): Promise<Metadata> {
  const inst = await requestInstanceDef();
  if (!inst) return SHARED_METADATA;
  return {
    title: inst.brand.product,
    description: inst.brand.tagline,
    icons: { icon: inst.brand.icon, apple: inst.brand.icon },
    appleWebApp: { title: inst.brand.name, statusBarStyle: "default" },
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const inst = await requestInstanceDef();
  // The instance's brand colors replace the cumulusOS primary and accent tokens everywhere.
  const style = inst
    ? ({
        "--primary": inst.brand.colors.primary,
        "--primary-hover": inst.brand.colors.primaryHover,
        "--primary-active": inst.brand.colors.primaryHover,
        "--accent": inst.brand.colors.primary,
        "--accent-hover": inst.brand.colors.primaryHover,
      } as CSSProperties)
    : undefined;
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} data-instance={inst?.id} style={style}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

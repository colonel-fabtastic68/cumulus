import type { ReactNode } from "react";
import localFont from "next/font/local";
import { MarketingFooter, MarketingNav } from "@/components/marketing/chrome";
import { SiteAssistant } from "@/components/marketing/SiteAssistant";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

// Archivo Expanded (SIL OFL, src/app/fonts) sets marketing headlines and race numbers only; the app never loads it.
const archivo = localFont({
  src: [
    { path: "../fonts/ArchivoExpanded-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "../fonts/ArchivoExpanded-ExtraBoldItalic.woff2", weight: "800", style: "italic" },
    { path: "../fonts/ArchivoExpanded-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo",
  display: "swap",
});

// Read FIREBASE_* at request time so the calls to action know whether this install has accounts.
export const dynamic = "force-dynamic";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const runtimeConfig = runtimeConfigFromEnv();
  return (
    <div className={`landing ${archivo.variable} flex min-h-[100dvh] flex-col bg-bg text-text`}>
      <MarketingNav runtimeConfig={runtimeConfig} />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <SiteAssistant />
    </div>
  );
}

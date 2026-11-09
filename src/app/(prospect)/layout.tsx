import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

// Same display face as the marketing site, without its nav, footer or assistant: each page carries its own.
const archivo = localFont({
  src: [
    { path: "../fonts/ArchivoExpanded-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "../fonts/ArchivoExpanded-ExtraBoldItalic.woff2", weight: "800", style: "italic" },
    { path: "../fonts/ArchivoExpanded-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo",
  display: "swap",
});

/** Pages made for one company and sent by email: no site chrome, nothing indexed, reachable only by their link. */
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function ProspectLayout({ children }: { children: ReactNode }) {
  return <div className={`landing ${archivo.variable} min-h-[100dvh] bg-surface text-text`}>{children}</div>;
}

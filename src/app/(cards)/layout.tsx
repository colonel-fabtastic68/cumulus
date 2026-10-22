import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/** Business-card pages: no site chrome, nothing indexed, reachable only by their slug. */
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f1f1f1" };

export default function CardsLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-bg text-text">{children}</div>;
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", weight: "variable" });

export const metadata: Metadata = {
  title: "cumulusOS",
  description: "Agentic, collaborative inventory management for small teams.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "cumulusOS", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

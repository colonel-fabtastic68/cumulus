import type { ReactNode } from "react";
import Link from "next/link";
import { CloudMark } from "@/components/ui";

/** Off-white page with the Cumulus mark top-left and the form card centred. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center px-6">
        <Link href="/" className="flex items-center gap-2 rounded-[var(--radius-sm)] text-[14px] font-semibold text-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
            <CloudMark />
          </span>
          Cumulus
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * Sits above the top bar on the staging build (dev.cumulusos.com and other
 * preview deployments), so nobody mistakes it for the live product: unreleased
 * features are on here, and without a database the data is the sample company's.
 */
export function StagingBar() {
  const { mode } = useAuth();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#f5d9a8] bg-[#fff4e5] px-4 py-1.5 text-[12.5px] text-[#5e4200]" role="status">
      <span className="inline-flex items-center gap-1.5 font-[550]">
        <FlaskConical className="h-3.5 w-3.5" /> Staging
      </span>
      <span className="text-[#5e4200]/85">
        Unreleased features are switched on here.{mode !== "firestore" ? " This is the sample company; changes stay in this browser." : ""}
      </span>
      <Link href="/settings#labs" className="ml-auto font-medium underline underline-offset-2">
        Labs
      </Link>
    </div>
  );
}

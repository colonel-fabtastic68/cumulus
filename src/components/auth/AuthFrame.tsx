import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { AppIcon } from "@/components/ui";
import type { InstanceRuntime } from "@/lib/instances";

/** Off-white page with the cumulusOS mark top-left and the form card centered. */
export function AuthFrame({ children, instance }: { children: ReactNode; instance?: InstanceRuntime }) {
  if (instance) return <InstanceAuthFrame instance={instance}>{children}</InstanceAuthFrame>;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center px-6">
        <Link href="/" className="flex items-center gap-2 rounded-[var(--radius-sm)] text-[14px] font-semibold text-text">
          <AppIcon size={28} />
          cumulusOS
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}

/**
 * A bespoke instance signs in under its own brand: the client's photo and logo
 * on a panel, the form beside it, and only a small "powered by" line for
 * cumulusOS. There is no link back to the shared product.
 */
function InstanceAuthFrame({ children, instance }: { children: ReactNode; instance: InstanceRuntime }) {
  const { brand } = instance;
  const panel: CSSProperties = {
    backgroundColor: brand.colors.panel,
    color: brand.colors.panelText,
    backgroundImage: brand.signInImage ? `linear-gradient(180deg, rgba(20,34,40,0.35) 0%, rgba(20,34,40,0.8) 100%), url(${brand.signInImage})` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg lg:flex-row">
      <aside className="flex min-h-[200px] flex-col justify-between p-6 sm:p-8 lg:min-h-0 lg:w-[44%] lg:p-12" style={panel}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoOnDark} alt={brand.name} className="h-auto w-[150px] sm:w-[190px] lg:w-[240px]" />
        <div className="mt-8 hidden max-w-[420px] lg:block">
          <p className="text-[26px] font-semibold leading-tight">{brand.product}</p>
          <p className="mt-2 text-[15px] leading-6 opacity-85">{brand.tagline}</p>
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center px-4 pb-10 pt-8 sm:pt-14">
        <div className="w-full max-w-[420px] flex-1">{children}</div>
        <p className="mt-10 text-[12px] text-text-tertiary">
          Powered by <span className="font-medium text-text-secondary">cumulusOS</span>
        </p>
      </main>
    </div>
  );
}

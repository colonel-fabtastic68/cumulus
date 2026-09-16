import type { ReactNode } from "react";

/** Shared chrome for the policy pages: one column, plain type, a date at the top. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[760px] px-6 py-14 md:py-20">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">{title}</h1>
      <p className="mt-3 text-[13px] text-text-tertiary">Last updated {updated}</p>
      <p className="mt-6 text-[15.5px] leading-7 text-text-secondary">{intro}</p>
      <div className="mt-8 flex flex-col gap-8">{children}</div>
    </section>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-text">{heading}</h2>
      <div className="mt-2 flex flex-col gap-3 text-[14.5px] leading-7 text-text-secondary">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

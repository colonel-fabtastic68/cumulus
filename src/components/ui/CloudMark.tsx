import { cn } from "@/lib/utils";

/** The Cumulus cloud mark. Inherits `currentColor`. */
export function CloudMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.3 8.5 4.75 4.75 0 0 0 7 19h10.5Z" />
    </svg>
  );
}

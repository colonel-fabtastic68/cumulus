import Image from "next/image";
import { cn } from "@/lib/utils";

/** The cumulusOS app icon (cloud and paper on the gray tile), for wordmarks and headers. */
export function AppIcon({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src="/icons/icon-192.png" alt="" width={size} height={size} className={cn("shrink-0 rounded-[22%]", className)} priority />;
}

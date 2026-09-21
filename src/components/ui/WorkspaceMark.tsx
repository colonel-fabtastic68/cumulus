import { AppIcon } from "./AppIcon";
import { cn } from "@/lib/utils";

/** The workspace's own icon when one is set, else the cumulusOS app icon. */
export function WorkspaceMark({ icon, size = 28, className, alt = "" }: { icon?: string | null; size?: number; className?: string; alt?: string }) {
  if (!icon) return <AppIcon size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element -- a data URL from the workspace, not an optimizable asset
  return <img src={icon} alt={alt} width={size} height={size} className={cn("shrink-0 rounded-[22%] object-cover", className)} style={{ width: size, height: size }} />;
}

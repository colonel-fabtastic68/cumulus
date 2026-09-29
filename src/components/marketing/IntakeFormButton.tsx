"use client";

import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui";
import { INTAKE_FORM_URL } from "@/lib/links";

/** Opens the launch-phase intake form in a new tab, from the site and from inside the demo. */
export function IntakeFormButton({ variant = "secondary", size = "md", label = "Tell us about your shop", className }: { variant?: "primary" | "secondary" | "tertiary" | "plain"; size?: "sm" | "md" | "lg"; label?: string; className?: string }) {
  return (
    <Button variant={variant} size={size} icon={<ClipboardList />} className={className} onClick={() => window.open(INTAKE_FORM_URL, "_blank", "noopener")}>
      {label}
    </Button>
  );
}

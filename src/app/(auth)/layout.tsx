import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

// Read FIREBASE_* at request time, like the app layout, so the pages know whether accounts exist.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Providers runtimeConfig={runtimeConfigFromEnv()}>
      <AuthFrame>{children}</AuthFrame>
    </Providers>
  );
}

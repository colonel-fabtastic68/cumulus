import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { requestRuntimeConfig } from "@/lib/server/runtime";

// Read FIREBASE_* at request time, like the app layout, so the pages know whether accounts exist.
export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const runtimeConfig = await requestRuntimeConfig();
  return (
    <Providers runtimeConfig={runtimeConfig}>
      <AuthFrame instance={runtimeConfig.instance}>{children}</AuthFrame>
    </Providers>
  );
}

import { headers } from "next/headers";
import { runtimeConfigForHost, type RuntimeConfig } from "@/lib/firebase-config";
import { instanceForHost, type InstanceDef } from "@/lib/instances";

/** The host a page request was made to. */
export async function requestHostHeader(): Promise<string> {
  const h = await headers();
  return h.get("host") ?? h.get("x-forwarded-host") ?? "";
}

/** Runtime config for the current page request, instance-aware (see runtimeConfigForHost). */
export async function requestRuntimeConfig(): Promise<RuntimeConfig> {
  return runtimeConfigForHost(await requestHostHeader());
}

/** The bespoke instance the current page request is for, or null on the shared product. */
export async function requestInstanceDef(): Promise<InstanceDef | null> {
  return instanceForHost(await requestHostHeader());
}

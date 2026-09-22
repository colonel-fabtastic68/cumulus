import { cookies } from "next/headers";
import { DEMO_COOKIE, safeExitPath } from "@/lib/demo";

/** Leaves the demo: the browser goes back to the hosted app (sign-in, sign-up or the site). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  (await cookies()).delete(DEMO_COOKIE);
  return Response.redirect(new URL(safeExitPath(url.searchParams.get("to")), url), 303);
}

import { cookies } from "next/headers";
import { DEMO_COOKIE, DEMO_COOKIE_MAX_AGE } from "@/lib/demo";
import { APP_HOME } from "@/lib/auth-routes";

/** Marks this browser as in the demo and opens the sample workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  (await cookies()).set(DEMO_COOKIE, "1", { path: "/", maxAge: DEMO_COOKIE_MAX_AGE, sameSite: "lax", secure: url.protocol === "https:" });
  return Response.redirect(new URL(APP_HOME, url), 303);
}

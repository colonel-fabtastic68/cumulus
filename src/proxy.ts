import { NextResponse, type NextRequest } from "next/server";
import { INSTANCE_ONLY_PREFIXES, SHARED_ONLY_PREFIXES, instanceForHost, matchesPrefix } from "@/lib/instances";

/**
 * The network boundary between the shared product and bespoke instances
 * (src/lib/instances.ts). On an instance host, everything that belongs to the
 * shared product (marketing, sign-up, workspace creation, billing, invites,
 * admin, MCP, OAuth hand-offs) answers 404 and the bare domain opens the app.
 * On the shared product, instance-only routes answer 404. Data isolation does
 * not rest on this file: the server picks the instance's own database and
 * account pool from the same hostname and rejects tokens from the other pool.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const instance = instanceForHost(host);
  const { pathname } = request.nextUrl;

  if (!instance) {
    if (matchesPrefix(pathname, INSTANCE_ONLY_PREFIXES)) return notFound();
    return NextResponse.next();
  }

  if (pathname === "/") return NextResponse.redirect(new URL("/home", request.url));
  // The browser tab shows the client's icon, not cumulusOS's.
  if (pathname === "/icon.png" || pathname === "/apple-icon.png" || pathname === "/favicon.ico") {
    return NextResponse.rewrite(new URL(instance.brand.icon, request.url));
  }
  if (pathname === "/manifest.webmanifest") return notFound();
  if (matchesPrefix(pathname, SHARED_ONLY_PREFIXES)) return notFound();
  return NextResponse.next();
}

function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export const config = {
  // Everything except build assets and image optimization; public files are matched so icons can be swapped.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

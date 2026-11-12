import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Staging and other preview deployments (dev.cumulusos.com) must not be indexed as copies of the live site.
  async headers() {
    if (process.env.VERCEL_ENV !== "preview") return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  // The agent was called Nimbus until September 2026. Old links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/nimbus/:path*", destination: "/strato/:path*", permanent: false },
      // Subscribing now happens while creating a workspace.
      { source: "/checkout/:path*", destination: "/workspaces/new", permanent: false },
    ];
  },
};

export default nextConfig;

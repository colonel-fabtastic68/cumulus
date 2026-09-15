import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // The agent was called Nimbus until September 2026. Old links and bookmarks keep working.
  async redirects() {
    return [{ source: "/nimbus/:path*", destination: "/strato/:path*", permanent: false }];
  },
};

export default nextConfig;

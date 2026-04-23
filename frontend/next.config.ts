import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/ws/:path*", destination: `${API_URL}/ws/:path*` },
      { source: "/uploads/:path*", destination: `${API_URL}/uploads/:path*` },
    ];
  },
  async redirects() {
    // V3 UI refonte — legacy routes redirect to the new navigation.
    // permanent:false so browsers don't cache aggressively while we iterate.
    return [
      { source: "/inventory", destination: "/frigo", permanent: false },
      { source: "/ingredients", destination: "/gerer/catalogue", permanent: false },
      { source: "/ingredients/variantes", destination: "/gerer/variantes", permanent: false },
      { source: "/imports", destination: "/gerer/imports", permanent: false },
      { source: "/settings", destination: "/gerer/settings", permanent: false },
      // /batches and /shopping stay working (recipe-detail + shopping live
      // there). The new nav points at /batch for the landing; /batches
      // remains canonical until Phase 2 reframes the flow.
    ];
  },
};

export default nextConfig;

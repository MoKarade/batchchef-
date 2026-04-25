import type { NextConfig } from "next";

// Default to :8001 to match supervisor.py / start.ps1. Override via
// frontend/.env.local if your backend listens elsewhere.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  // Next 15/16 blocks dev assets from cross-origin hosts unless the host
  // is whitelisted here. We allow all common dev-access channels:
  // LAN IPs, the ephemeral Cloudflare tunnel, and ngrok.
  allowedDevOrigins: [
    "10.10.0.146",
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
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
    //
    // /ingredients and /ingredients/variantes stay CANONICAL in V3 (the user
    // wants direct access to both the cleaned catalogue and the raw Marmiton
    // variants in the primary nav). The /gerer shortcuts now redirect INTO
    // /ingredients so bookmarks survive either way.
    return [
      { source: "/inventory", destination: "/frigo", permanent: false },
      { source: "/imports", destination: "/gerer/imports", permanent: false },
      { source: "/settings", destination: "/gerer/settings", permanent: false },
      { source: "/gerer/catalogue", destination: "/ingredients", permanent: false },
      { source: "/gerer/variantes", destination: "/ingredients/variantes", permanent: false },
    ];
  },
};

export default nextConfig;

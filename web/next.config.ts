import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Images de recettes : URLs externes arbitraires (sites de recettes) → pas d'optimisation
  // serveur (coût/allowlist) ; on sert les <img> telles quelles.
  images: { unoptimized: true },
};

export default nextConfig;

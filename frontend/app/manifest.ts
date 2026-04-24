import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the app installable on Android/iOS home screen and
 * gives it a proper standalone window on desktop Chrome.
 *
 * Next.js reads ``manifest.ts`` at build time and produces ``/manifest.json``.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BatchChef",
    short_name: "BatchChef",
    description: "Planificateur de batch cooking intelligent",
    start_url: "/planifier",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#faf7f2",
    theme_color: "#b94a2e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    categories: ["food", "lifestyle", "productivity"],
    lang: "fr-CA",
  };
}

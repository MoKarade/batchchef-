import type { NextConfig } from "next";

/**
 * CSP en REPORT-ONLY (2026-07-31). BatchChef n'avait AUCUN en-tête de sécurité.
 *
 * Le cas particulier ici, c'est `img-src` : les recettes affichent des photos dont l'URL
 * vient de N'IMPORTE QUEL site de recettes (`images: { unoptimized: true }` juste en
 * dessous, pour la même raison). On ne peut donc pas fermer `img-src` à une allowlist —
 * `https:` est le maximum réaliste, et ça reste utile : ça interdit `http:` en clair.
 *
 * Report-Only parce que la politique n'a pas été vérifiée dans un navigateur : une CSP
 * trop stricte casse silencieusement, et ni le build ni les tests ne l'attrapent.
 * ➜ POUR PASSER EN ENFORCÉ : ouvrir l'accueil, /recettes, /catalogue, /batchs, /courses/[id],
 *   vérifier qu'aucune violation n'apparaît en console, puis renommer la clé
 *   `Content-Security-Policy-Report-Only` en `Content-Security-Policy`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Photos de recettes : domaines arbitraires. `https:` interdit au moins le HTTP en clair.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Les appels Google Tasks et Anthropic partent du SERVEUR (Server Actions), jamais du
  // navigateur → 'self' suffit.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // Le flux OAuth Google poste vers accounts.google.com depuis le formulaire de connexion.
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy-Report-Only", value: CSP },
  // HSTS : l'app est 100 % HTTPS (Vercel).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // La liste d'épicerie s'ouvre sur le téléphone et contient des liens sortants : on ne
  // fuite pas l'URL complète vers le site de destination.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Images de recettes : URLs externes arbitraires (sites de recettes) → pas d'optimisation
  // serveur (coût/allowlist) ; on sert les <img> telles quelles.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

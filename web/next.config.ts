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
  // Import vidéo : le fichier déposé est lu localement via une URL blob: (extraction des
  // images dans le navigateur). Sans cette ligne, `default-src 'self'` le bloquerait au
  // passage en enforcé — et la fonctionnalité mourrait en silence.
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // Les appels Google Tasks et Anthropic partent du SERVEUR (Server Actions), jamais du
  // navigateur → 'self' suffit.
  "connect-src 'self'",
  // PWA : le service worker qui reçoit les partages Android, et le manifeste qui déclare
  // la cible de partage. Explicites plutôt que dépendants du repli sur `default-src` —
  // une CSP se lit, elle ne se déduit pas.
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // Deux flux partent d'un formulaire de cette app :
  //   - la connexion Google, qui poste vers accounts.google.com ;
  //   - la page de consentement du connecteur MCP (`/api/mcp/oauth/authorize`), qui poste
  //     vers elle-même PUIS REDIRIGE vers Claude avec le code d'autorisation.
  // ⚠️ `form-action` couvre la CHAÎNE DE REDIRECTION qui suit une soumission, pas seulement
  // la première cible : sans claude.ai/claude.com ici, le passage de la CSP en enforcé
  // couperait le branchement du connecteur À LA DERNIÈRE ÉTAPE — le navigateur bloquerait
  // silencieusement le retour vers Claude, et ça ressemblerait à « le connecteur ne marche
  // pas ». Posé aujourd'hui, où la CSP n'observe encore que, pour que le jour du passage en
  // enforcé ne révèle pas ce trou-là.
  "form-action 'self' https://accounts.google.com https://claude.ai https://claude.com",
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
  experimental: {
    // L'import vidéo poste jusqu'à 12 images JPEG en base64 (~3 Mo bornés côté client ET
    // revérifiés côté serveur). Le défaut d'une Server Action est 1 Mo : sans ce relèvement,
    // l'analyse échouerait dès la première vraie vidéo. 4 Mo reste sous la limite de 4,5 Mo
    // d'une fonction serverless Vercel, qui rejetterait la requête avant notre code.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

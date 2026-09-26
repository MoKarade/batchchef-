// lib/urlPublique.ts — garde SSRF de l'import par URL (P2 de l'audit sécurité, 26/09/2026).
//
// Module ORDINAIRE, jamais `"use server"` (tout export d'un tel fichier devient un point
// d'entrée appelable). L'import télécharge une page choisie par l'utilisateur : sans garde,
// le serveur peut être poussé vers localhost, le réseau privé ou les métadonnées cloud, et
// le message d'erreur (`fail`) renverrait ce qu'il y voit.
//
// Ce que la garde fait : http(s) seulement, pas d'identifiants dans l'URL, pas d'hôte
// interne (localhost, .local, .internal), pas d'adresse privée / boucle / lien-local /
// métadonnées (littérale OU résolue par DNS), redirections suivies à la main (5 max) et
// re-vérifiées à chaque saut, corps borné.
// Limite connue : la résolution DNS se fait avant le fetch (fenêtre de « DNS rebinding »).
// Le réseau sortant de Vercel n'atteint pas de service interne exploitable ; la garde retire
// la classe d'attaque triviale, pas la théorique.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_REDIRECTIONS = 5;
export const MAX_OCTETS_PAGE = 2_000_000;
const DELAI_MS = 15_000;

export class UrlRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlRefusee";
  }
}

/** Adresse IPv4 (a.b.c.d) dans une plage non publique ? */
function ipv4NonPublique(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // lien-local + métadonnées cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, réservé, diffusion
  );
}

/** Adresse IP (v4 ou v6) non publique ? Toute forme illisible est refusée. */
export function ipNonPublique(brut: string): boolean {
  const ip = brut.replace(/^\[|\]$/g, "").toLowerCase();
  const v = isIP(ip);
  if (v === 4) return ipv4NonPublique(ip);
  if (v !== 6) return true;
  if (ip === "::" || ip === "::1") return true;
  // IPv4 mappée (::ffff:a.b.c.d ou ::ffff:xxxx:xxxx) : on juge l'IPv4 contenue.
  const mappee = ip.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mappee) {
    if (mappee[1]) return ipv4NonPublique(mappee[1]);
    const h = parseInt(mappee[2]!, 16);
    const l = parseInt(mappee[3]!, 16);
    return ipv4NonPublique(`${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`);
  }
  const premier = parseInt(ip.split(":")[0] || "0", 16);
  return (
    (premier & 0xfe00) === 0xfc00 || // ULA fc00::/7
    (premier & 0xffc0) === 0xfe80 || // lien-local fe80::/10
    (premier & 0xff00) === 0xff00 // multicast
  );
}

export type Resolveur = (hote: string) => Promise<string[]>;

const resolveurDns: Resolveur = async (hote) =>
  (await lookup(hote, { all: true })).map((r) => r.address);

/** Valide une URL à télécharger ; rend l'URL normalisée ou jette `UrlRefusee`. */
export async function verifierUrlPublique(
  brut: string,
  resoudre: Resolveur = resolveurDns,
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    throw new UrlRefusee("URL invalide.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UrlRefusee("URL http(s) uniquement.");
  if (u.username || u.password) throw new UrlRefusee("URL avec identifiants refusée.");

  const hote = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hote ||
    hote === "localhost" ||
    hote.endsWith(".localhost") ||
    hote.endsWith(".local") ||
    hote.endsWith(".internal") ||
    hote.endsWith(".lan")
  ) {
    throw new UrlRefusee("Adresse interne refusée.");
  }
  if (isIP(hote.replace(/^\[|\]$/g, "")) !== 0) {
    if (ipNonPublique(hote)) throw new UrlRefusee("Adresse privée refusée.");
    return u;
  }
  let adresses: string[];
  try {
    adresses = await resoudre(hote);
  } catch {
    throw new UrlRefusee("Hôte introuvable.");
  }
  if (adresses.length === 0 || adresses.some(ipNonPublique)) {
    throw new UrlRefusee("Adresse privée refusée.");
  }
  return u;
}

/** Lit un corps en s'arrêtant à `max` octets (jamais toute la réponse en mémoire). */
async function lireBorne(reponse: Response, max: number): Promise<string> {
  const lecteur = reponse.body?.getReader();
  if (!lecteur) return "";
  const morceaux: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    total += value.byteLength;
  }
  void lecteur.cancel().catch(() => undefined);
  const tout = new Uint8Array(Math.min(total, max));
  let pos = 0;
  for (const m of morceaux) {
    const part = m.subarray(0, tout.length - pos);
    tout.set(part, pos);
    pos += part.length;
    if (pos >= tout.length) break;
  }
  return new TextDecoder().decode(tout);
}

/**
 * Télécharge une page publique : redirections suivies à la main et re-vérifiées, corps borné.
 * `fetcher` et `resoudre` sont injectables (tests : aucun réseau).
 */
export async function telechargerPagePublique(
  url: string,
  options: { fetcher?: typeof fetch; resoudre?: Resolveur; userAgent?: string } = {},
): Promise<{ ok: boolean; status: number; texte: string }> {
  const fetcher = options.fetcher ?? fetch;
  let courante = await verifierUrlPublique(url, options.resoudre);
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    const reponse = await fetcher(courante, {
      redirect: "manual",
      headers: options.userAgent ? { "user-agent": options.userAgent } : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (reponse.status >= 300 && reponse.status < 400) {
      const cible = reponse.headers.get("location");
      if (!cible) throw new UrlRefusee("Redirection sans destination.");
      courante = await verifierUrlPublique(new URL(cible, courante).toString(), options.resoudre);
      continue;
    }
    if (!reponse.ok) return { ok: false, status: reponse.status, texte: "" };
    return { ok: true, status: reponse.status, texte: await lireBorne(reponse, MAX_OCTETS_PAGE) };
  }
  throw new UrlRefusee("Trop de redirections.");
}

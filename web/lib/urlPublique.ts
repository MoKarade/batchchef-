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

import { type LookupAddress } from "node:dns";
import { lookup as lookupPromesse } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
  const h = hextets(ip);
  if (!h) return true;
  // LISTE BLANCHE : seul 2000::/3 (unicast global) passe ; tout le reste est refusé
  // (::1, ::, ULA, lien-local, mappées ::ffff:, compatibles ::a.b.c.d, NAT64 64:ff9b::/96…).
  if (h[0]! < 0x2000 || h[0]! > 0x3fff) return true;
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) return true; // Teredo, documentation
  if (h[0] === 0x2002) return true; // 6to4
  return false;
}

/** Développe une IPv6 en 8 groupes de 16 bits (null si illisible). */
function hextets(ip: string): number[] | null {
  let texte = ip.split("%")[0]!;
  const v4 = texte.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1]!.split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    texte = texte.slice(0, -v4[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ":" + ((o[2]! << 8) | o[3]!).toString(16);
  }
  const [gauche, droite, ...reste] = texte.split("::");
  if (reste.length > 0) return null;
  const g = gauche ? gauche.split(":") : [];
  const d = droite === undefined ? [] : droite ? droite.split(":") : [];
  const manque = 8 - g.length - d.length;
  if (droite === undefined ? manque !== 0 : manque < 1) return null;
  const tous = [...g, ...Array(droite === undefined ? 0 : manque).fill("0"), ...d].map((x) => parseInt(x, 16));
  return tous.length === 8 && tous.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? tous : null;
}

export type Resolveur = (hote: string) => Promise<string[]>;

const resolveurDns: Resolveur = async (hote) =>
  (await lookupPromesse(hote, { all: true })).map((r) => r.address);

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
  // `URL` retire le port par défaut : « » = 80/443 ; tout autre port (22, 6379…) est refusé.
  if (u.port !== "" && u.port !== "80" && u.port !== "443") throw new UrlRefusee("Port refusé (80 et 443 seulement).");

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

type CallbackLookup = (
  err: NodeJS.ErrnoException | null,
  adresse: string | LookupAddress[],
  famille?: number,
) => void;

/**
 * `lookup` de connexion : c'est LUI que la socket appelle, donc l'adresse vérifiée est
 * exactement celle à laquelle on se connecte (pas de seconde résolution → pas de DNS
 * rebinding). Toute adresse non publique fait échouer la connexion.
 */
export function lookupPublic(resoudre: Resolveur = resolveurDns) {
  return (hote: string, options: { all?: boolean }, rappel: CallbackLookup): void => {
    resoudre(hote).then(
      (adresses) => {
        if (adresses.length === 0 || adresses.some(ipNonPublique)) {
          rappel(new UrlRefusee("Adresse privée refusée."), "", 0);
          return;
        }
        const av = adresses.map((address) => ({ address, family: isIP(address) }));
        if (options?.all) rappel(null, av);
        else rappel(null, av[0]!.address, av[0]!.family);
      },
      (err: unknown) => rappel(err as NodeJS.ErrnoException, "", 0),
    );
  };
}

export interface ReponseBrute {
  status: number;
  location: string | null;
  corps: AsyncIterable<Uint8Array>;
  fermer: () => void;
}

export type Transport = (
  url: URL,
  opts: { lookup: ReturnType<typeof lookupPublic>; userAgent?: string },
) => Promise<ReponseBrute>;

/** Transport réel : http(s).request avec notre `lookup` (aucune redirection automatique). */
export const transportNode: Transport = (url, opts) =>
  new Promise((resolve, reject) => {
    const requeter = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requeter(
      url,
      {
        method: "GET",
        lookup: opts.lookup as never,
        headers: opts.userAgent ? { "user-agent": opts.userAgent } : {},
        signal: AbortSignal.timeout(DELAI_MS),
      },
      (res) => {
        const loc = res.headers.location;
        resolve({
          status: res.statusCode ?? 0,
          location: typeof loc === "string" ? loc : null,
          corps: res,
          fermer: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

/** Lit un corps en s'arrêtant à `max` octets (jamais toute la réponse en mémoire). */
async function lireBorne(reponse: ReponseBrute, max: number): Promise<string> {
  const tout = new Uint8Array(max);
  let pos = 0;
  for await (const morceau of reponse.corps) {
    const part = morceau.subarray(0, max - pos);
    tout.set(part, pos);
    pos += part.length;
    if (pos >= max) break;
  }
  reponse.fermer();
  return new TextDecoder().decode(tout.subarray(0, pos));
}

/**
 * Télécharge une page publique : redirections suivies à la main et revérifiées (pas de
 * https → http), adresse vérifiée AU MOMENT DE LA CONNEXION, corps borné.
 * `transport` et `resoudre` sont injectables (tests : aucun réseau).
 */
export async function telechargerPagePublique(
  url: string,
  options: { transport?: Transport; resoudre?: Resolveur; userAgent?: string } = {},
): Promise<{ ok: boolean; status: number; texte: string }> {
  const transport = options.transport ?? transportNode;
  const lookup = lookupPublic(options.resoudre);
  let courante = await verifierUrlPublique(url, options.resoudre);
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    const reponse = await transport(courante, { lookup, userAgent: options.userAgent });
    if (reponse.status >= 300 && reponse.status < 400) {
      reponse.fermer();
      if (!reponse.location) throw new UrlRefusee("Redirection sans destination.");
      const suivante = await verifierUrlPublique(new URL(reponse.location, courante).toString(), options.resoudre);
      if (courante.protocol === "https:" && suivante.protocol === "http:") {
        throw new UrlRefusee("Redirection https vers http refusée.");
      }
      courante = suivante;
      continue;
    }
    if (reponse.status < 200 || reponse.status >= 300) {
      reponse.fermer();
      return { ok: false, status: reponse.status, texte: "" };
    }
    return { ok: true, status: reponse.status, texte: await lireBorne(reponse, MAX_OCTETS_PAGE) };
  }
  throw new UrlRefusee("Trop de redirections.");
}

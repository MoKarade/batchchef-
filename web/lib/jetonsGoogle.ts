// lib/jetonsGoogle.ts — les jetons Google portés par le JWT de session.
//
// ── POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST IDENTIQUE DANS QUATRE APPS ────────
//
// Depuis la connexion unique (docs/CONNEXION-UNIQUE.md dans Hubperso), les quatre apps
// Auth.js — Hubperso, JobAI, CarAI, BatchChef — partagent UN SEUL cookie de session.
// Corollaire : c'est la DERNIÈRE app où l'on s'est connecté qui décide du contenu du
// jeton. Si le hub minte un jeton sans portée Google, BatchChef se retrouve connecté
// mais incapable d'écrire dans Google Tasks.
//
// La décision de Marc (13/08/2026) : accès complets partout, aucune reconnexion. Les
// quatre apps demandent donc les MÊMES portées et capturent les MÊMES jetons, pour que
// n'importe quelle connexion produise un jeton complet et utilisable par toutes.
//
// C'est pour ça que ce fichier doit rester rigoureusement identique dans les quatre
// dépôts : une divergence de portées ferait dépendre le bon fonctionnement de l'app par
// laquelle on est passé — le pire genre de bogue, celui qui n'arrive qu'une fois sur
// quatre et qu'on n'arrive jamais à reproduire.
//
// ── POURQUOI `prompt=consent` MALGRÉ SON COÛT ───────────────────────────────────────
//
// Google n'émet un `refresh_token` qu'à la PREMIÈRE autorisation d'un couple
// client + compte — sauf si le consentement est forcé. Or les apps partagent un seul
// client OAuth : cette première autorisation est justement déjà faite. Sans
// `prompt=consent`, une connexion rendrait donc un jeton d'accès d'une heure et RIEN
// pour le renouveler. Le prix est un écran de consentement à chaque connexion ; les
// sessions durent, on le voit rarement.

import type { Account } from "next-auth";
import type { JWT } from "next-auth/jwt";

/** Écriture dans Google Tasks — la liste d'épicerie cochable de BatchChef. */
export const PORTEE_TASKS = "https://www.googleapis.com/auth/tasks";

/**
 * Les portées demandées par les QUATRE apps. Volontairement limitées à l'identité plus
 * Tasks : ni Drive, ni Agenda, ni Gmail. DriveAI et FinanceAI n'utilisent pas ce cookie
 * — leur ajouter leurs portées ici n'apporterait rien et multiplierait par quatre les
 * portes vers un Drive complet.
 */
export const PORTEES_GOOGLE = `openid email profile ${PORTEE_TASKS}`;

/** Paramètres passés au provider Google. Voir l'en-tête pour `prompt`/`access_type`. */
export const PARAMS_AUTORISATION = {
  scope: PORTEES_GOOGLE,
  access_type: "offline",
  prompt: "consent",
};

/**
 * Marge avant expiration : on renouvelle une minute d'avance plutôt qu'à la seconde,
 * pour qu'un appel lancé juste avant la limite n'arrive pas après.
 */
export const MARGE_EXPIRATION_MS = 60_000;

/** Fonction PURE — c'est la partie décidable, donc la partie testable. */
export function jetonExpire(expiresAt: number | undefined, maintenantMs: number): boolean {
  if (!expiresAt) return true; // pas d'échéance connue ⇒ on ne parie pas dessus
  return maintenantMs >= expiresAt * 1000 - MARGE_EXPIRATION_MS;
}

/** Rafraîchit le jeton d'accès via le refresh_token. Erreur → marque le jeton. */
export async function rafraichirJetonGoogle(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error("pas de refresh_token");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
    };
    if (!res.ok || !data.access_token) throw new Error(data.error ?? `HTTP ${res.status}`);
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      // Google ne renvoie pas toujours un nouveau refresh_token : garder l'ancien.
      refreshToken: data.refresh_token ?? token.refreshToken,
      // Efface une erreur précédente : un échec réseau ponctuel ne doit pas condamner
      // la session pour de bon.
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

/**
 * Met le jeton à jour : capture à la connexion, renouvellement ensuite.
 *
 * Appelée à l'identique par les quatre apps. Celle par laquelle on passe rafraîchit pour
 * toutes les autres — le cookie étant partagé, le jeton renouvelé leur profite aussitôt.
 */
export async function majJetonsGoogle(
  token: JWT,
  account: Account | null | undefined,
): Promise<JWT> {
  // Connexion initiale : `account` porte les jetons fraîchement émis par Google.
  if (account) {
    return {
      ...token,
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      expiresAt: typeof account.expires_at === "number" ? account.expires_at : undefined,
      scope: account.scope,
      error: undefined,
    };
  }
  // Aucun jeton dans la session (ex. session mintée avant ce changement) : rien à
  // renouveler, et surtout rien à inventer. `rafraichirJetonGoogle` marquera l'erreur,
  // que BatchChef traduit par « clique Reconnecter Google ».
  if (!jetonExpire(token.expiresAt, Date.now())) return token;
  return await rafraichirJetonGoogle(token);
}

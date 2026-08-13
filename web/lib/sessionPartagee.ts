// lib/sessionPartagee.ts — connexion unique entre les apps du hub perso.
//
// Le cookie de session d'Auth.js est normalement posé sur l'HÔTE exact qui l'émet :
// `batchchef.hubperso.com` ne l'enverrait jamais à `carai.hubperso.com`. En lui déclarant
// le domaine parent `.hubperso.com`, le navigateur l'envoie à TOUS les sous-domaines —
// se connecter à une app vaut alors pour toutes (à condition que les apps partagent le
// même AUTH_SECRET, sans quoi elles reçoivent le cookie sans pouvoir le lire).
//
// ── POURQUOI C'EST UNE VARIABLE D'ENVIRONNEMENT ET NON UNE CONSTANTE ────────────────
// Un cookie portant `Domain=.hubperso.com` est REJETÉ par le navigateur sur tout autre
// hôte : `localhost` en développement, `<projet>.vercel.app` en préversion. Écrit en
// dur, le partage casserait donc la connexion partout ailleurs qu'en production — et
// silencieusement : le cookie n'est pas posé, on retombe sur /login en boucle, sans
// erreur nulle part. `AUTH_COOKIE_DOMAIN` n'est donc défini QUE dans l'environnement
// de production, où l'app sert bien un sous-domaine de hubperso.com.
//
// Fichier IDENTIQUE dans Hubperso, JobAI et CarAI. Documentation commune :
// Hubperso, `docs/CONNEXION-UNIQUE.md`.

import type { NextAuthConfig } from "next-auth";

/**
 * Construit le bloc `cookies` d'Auth.js pour partager la session entre sous-domaines.
 * Retourne `undefined` (= comportement natif, cookie limité à l'hôte) si aucun domaine
 * n'est configuré.
 *
 * ⚠️ SEUL `sessionToken` reçoit un domaine, JAMAIS `csrfToken`. Auth.js nomme ce
 * dernier `__Host-authjs.csrf-token`, et le préfixe `__Host-` INTERDIT l'attribut
 * `Domain` : lui en poser un ferait rejeter le cookie et casserait la connexion partout.
 * Le préfixe `__Secure-` de la session, lui, l'autorise.
 */
export function cookiesSessionPartagee(
  domaine: string | undefined,
): NextAuthConfig["cookies"] {
  const valeur = domaine?.trim();
  if (!valeur) return undefined;

  return {
    sessionToken: {
      // Le nom est FIXÉ plutôt que dérivé : Auth.js ne préfixe `__Secure-` que
      // lorsqu'il se croit en HTTPS. En le figeant, le cookie porte le même nom dans
      // chaque app — condition pour qu'une app lise celui déposé par une autre.
      name: "__Secure-authjs.session-token",
      options: {
        httpOnly: true,
        // `lax` et non `strict` : le retour de Google est une navigation cross-site,
        // et `strict` empêcherait le cookie d'être envoyé à ce moment-là.
        sameSite: "lax",
        path: "/",
        // Non négociable avec le préfixe `__Secure-`, et de toute façon exigé dès
        // qu'on partage une session entre hôtes.
        secure: true,
        domain: valeur,
      },
    },
  };
}

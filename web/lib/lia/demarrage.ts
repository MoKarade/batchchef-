// lib/lia/demarrage.ts — LIA montée HORS du rendu de l'app, dès le chargement (Marc, 23/10/2026 : « présente tout le temps,
// même si quelque chose charge, même si une page bug »). Appelée par `instrumentation-client.ts`, qui s'exécute avant
// l'hydratation : LIA ne dépend ni d'un composant, ni d'un écran de chargement, ni d'une error boundary.
//
// Une seule voie : plus de `<Lia/>` dans le layout (deux montages feraient deux LIA).

import { demarrerLia } from "@mokarade/lia-ui/boot";
import { demanderLia } from "@/lib/lia/client";

/** Routes SANS LIA : la page de connexion (rien à demander sans session). Toute autre page est derrière le middleware. */
export function sansLia(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export function demarrerLiaApp(pathname: string = window.location.pathname): void {
  if (sansLia(pathname)) return;
  demarrerLia({ ask: (question, signal) => demanderLia(question, signal, { page: window.location.pathname }) });
}

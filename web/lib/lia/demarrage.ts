// lib/lia/demarrage.ts — LIA montée HORS du rendu de l'app, dès le chargement (Marc, 23/10/2026 : « présente tout le temps,
// même si quelque chose charge, même si une page bug »). Appelée par `instrumentation-client.ts`, qui s'exécute avant
// l'hydratation : LIA ne dépend ni d'un composant, ni d'un écran de chargement, ni d'une error boundary.
//
// Une seule voie : plus de `<Lia/>` dans le layout (deux montages feraient deux LIA).
//
// Mode invité (24/10/2026, Marc : « présente tout le temps, y compris sur /login ») : LIA est aussi sur `/login`, où il n'y a
// pas de session. Elle y bouge, a une humeur et parle avec ses propres phrases, mais son `ask` refuse AVANT tout réseau (elle
// dit « indisponible ») ; la route `/api/lia/ask` reste derrière la session. Le mode se relit à CHAQUE question d'après la
// page courante : une déconnexion qui mène à `/login` sans rechargement complet referme `ask` aussi.

import { demarrerLia } from "@mokarade/lia-ui/boot";
import { demanderLia } from "@/lib/lia/client";
import type { ReponseLiaApp } from "@/lib/lia/contrat";

export type AskLia = (question: string, signal: AbortSignal) => Promise<ReponseLiaApp>;

/** Pas de session sur la page de connexion : LIA y est en mode invité. Toute autre page est derrière le middleware. */
export function enModeInvite(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

/** Enveloppe `ask` : en mode invité, rejette sans appeler le réseau ; sinon délègue tel quel. La page est relue à chaque appel. */
export function creerAsk(ask: AskLia, page: () => string): AskLia {
  return (question, signal) => {
    if (enModeInvite(page())) return Promise.reject(new Error("LIA indisponible (pas de session)"));
    return ask(question, signal);
  };
}

export function demarrerLiaApp(): void {
  const page = () => window.location.pathname;
  demarrerLia({ ask: creerAsk((question, signal) => demanderLia(question, signal, { page: page() }), page) });
}

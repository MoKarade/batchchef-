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

import type { EtatHote, OptionsLia } from "@mokarade/lia-ui";
import { demarrerLia, type DemarrageLia } from "@mokarade/lia-ui/boot";
import { etatHttp } from "@mokarade/lia-ui/etat-http";
import { demanderLia, lirePauseServeur } from "@/lib/lia/client";
import type { ReponseLiaApp } from "@/lib/lia/contrat";
import { PAS_SUIVI_PAUSE_MS, creerSuiviPause, type SuiviPause } from "@/lib/lia/pause";

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

/**
 * Ce que LIA lit comme « en pause » (option `pause` de lia-ui). Sur la page de connexion rien ne part au réseau (`creerAsk`),
 * il n'y a donc rien à couper et pas de session pour lire la pause : jamais en pause. Ailleurs : la pause générale du hub,
 * et une pause qu'on ne sait pas lire vaut pause (échec fermé).
 */
export function creerPause(suivi: Pick<SuiviPause, "enPause">, page: () => string): () => boolean {
  return () => (enModeInvite(page()) ? false : suivi.enPause());
}

/**
 * Son état partagé (option `etat` de lia-ui) : le même que celui du hub et des autres apps (route `/api/lia/etat`, relayée au hub).
 * Sur la page de connexion il n'y a pas de session : rien ne part au réseau, LIA y garde son état local (`null` = aucun état chez
 * l'hôte, `ecrire` ne rend rien). Ailleurs : l'hôte tel quel ; s'il échoue, LIA vit quand même sur son état local.
 */
export function creerEtat(hote: EtatHote, page: () => string): EtatHote {
  return {
    lire: () => (enModeInvite(page()) ? Promise.resolve(null) : hote.lire()),
    ecrire: (etat) => (enModeInvite(page()) ? Promise.resolve(null) : hote.ecrire(etat)),
  };
}

/** Relit la pause tant qu'il le faut, sauf sur la page de connexion (aucune session, aucun appel). */
export function sonderPause(
  suivi: Pick<SuiviPause, "doitRelire" | "rafraichir">,
  page: () => string,
  planifier: (tache: () => void, ms: number) => unknown = setInterval,
): void {
  const pas = (): void => {
    if (!enModeInvite(page()) && suivi.doitRelire()) void suivi.rafraichir();
  };
  pas();
  planifier(pas, PAS_SUIVI_PAUSE_MS);
}

/**
 * La page /assistant est l'atelier de LIA (tâche #346) : la discussion en pleine page, dans un conteneur que la page rend. Le
 * mode `atelier` est lu au montage seulement et exige ce conteneur ; au chargement (avant l'hydratation) il n'existe pas encore.
 * Sur ce chemin la bulle n'est donc pas démarrée : la page monte LIA elle-même (`components/AtelierLia.tsx`), et UNE SEULE LIA
 * vit toujours (deux feraient deux corps).
 */
export function enAtelier(pathname: string): boolean {
  return pathname === "/assistant" || pathname.startsWith("/assistant/");
}

// Les réglages de la bulle, gardés pour que l'atelier monte la MÊME LIA (mêmes `pause` et `etat`) et que la bulle puisse revenir.
let options: OptionsLia | null = null;
let bulle: DemarrageLia | null = null;

/** Les réglages communs de LIA dans cette app ; `null` tant que `demarrerLiaApp` n'a pas tourné (aucune LIA à reprendre). */
export function optionsLiaApp(): OptionsLia | null {
  return options;
}

/** Pose la bulle (idempotent). Jamais appelée juste pour être arrêtée : `demarrerLia` monte tout de suite. */
export function demarrerBulle(): void {
  if (!options || bulle) return;
  bulle = demarrerLia(options) ?? null;
}

/** Retire la bulle (la page /assistant prend le relais). Sans effet si elle n'est pas posée. */
export function arreterBulle(): void {
  bulle?.arreter();
  bulle = null;
}

export function demarrerLiaApp(
  planifier?: (tache: () => void, ms: number) => unknown,
  hoteEtat: () => EtatHote = () => etatHttp("/api/lia/etat"),
): void {
  const page = () => window.location.pathname;
  const suivi = creerSuiviPause(lirePauseServeur, () => Date.now());
  sonderPause(suivi, page, planifier);
  options = {
    ask: creerAsk((question, signal) => demanderLia(question, signal, { page: page() }), page),
    pause: creerPause(suivi, page),
    etat: creerEtat(hoteEtat(), page),
  };
  bulle = null;
  if (!enAtelier(page())) demarrerBulle();
}

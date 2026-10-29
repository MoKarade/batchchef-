// lib/appsDuParc.ts
//
// La liste figée des destinations du parc d'apps de l'écosystème hub perso (tâche 212 d'app-template,
// mission 846 de MoKarade/.github). Rien n'est affiché ici : c'est la base que le composant de navigation entre apps
// et les six apps réutilisent. La vérité de la liste est `Hubperso/lib/sources.ts` (`APPS`, champ `accueil`) ; ce
// fichier s'en COPIE tel quel, jamais lu à l'exécution (aucun fetch). Détail : `docs/claude/14-nav-apps.md`.
//
// Le hub est à `https://www.hubperso.com` : `https://hubperso.com` répond 308 vers `www` (relevé du 29/10/2026).

export type AppId = "hub" | "financeai" | "driveai" | "batchchef" | "carai" | "jobai" | "memoryai";

export interface AppDuParc {
  readonly id: AppId;
  readonly nom: string;
  /** Origine https de l'accueil, sans chemin ni barre finale. */
  readonly adresse: string;
}

const liste: readonly AppDuParc[] = [
  { id: "hub", nom: "Hub", adresse: "https://www.hubperso.com" },
  { id: "financeai", nom: "FinanceAI", adresse: "https://finance.hubperso.com" },
  { id: "driveai", nom: "DriveAI", adresse: "https://drive.hubperso.com" },
  { id: "batchchef", nom: "BatchChef", adresse: "https://batchchef.hubperso.com" },
  { id: "carai", nom: "CarAI", adresse: "https://carai.hubperso.com" },
  { id: "jobai", nom: "JobAI", adresse: "https://emploi.hubperso.com" },
  { id: "memoryai", nom: "MemoryAI", adresse: "https://memoryai.hubperso.com" },
];

/** Les 7 destinations, dans l'ordre d'affichage. Gelée : ni la liste ni ses entrées ne changent à l'exécution. */
export const APPS_DU_PARC: readonly AppDuParc[] = Object.freeze(liste.map((app) => Object.freeze({ ...app })));

/**
 * Toutes les destinations SAUF l'app courante, dans l'ordre de la liste.
 * Un id inconnu LÈVE une erreur : une liste vide silencieuse cacherait une faute de frappe dans l'id d'un fork.
 */
export function autresApps(courant: AppId): readonly AppDuParc[] {
  if (!APPS_DU_PARC.some((app) => app.id === courant)) {
    throw new Error(`autresApps : app courante inconnue « ${String(courant)} ».`);
  }
  return APPS_DU_PARC.filter((app) => app.id !== courant);
}

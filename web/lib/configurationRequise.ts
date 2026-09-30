// lib/configurationRequise.ts — liste FIGÉE des variables d'environnement sans lesquelles
// une fonctionnalité CŒUR (connexion, base, accès) casse. Lue par la sonde publique
// `GET /api/sante/configuration` (F7, prévention INC-16).
//
// ⚠️ Liste écrite à la main, jamais dérivée d'un fichier `.env` : en production, aucun
// fichier de configuration n'est lu. Ajouter une variable ici = décider qu'elle est cœur.
// Le détail (rôle, conséquence si absente, variables optionnelles) : docs/claude/09-variables.md.

type Env = Readonly<Record<string, string | undefined>>;

export const VARIABLES_REQUISES = [
  // Base : sans elle, toute requête qui lit la base lève (lib/db, connexion paresseuse).
  "DATABASE_URL",
  // Authentification : sans l'une des deux, le middleware répond 503 à TOUT (INC-16).
  "AUTH_SECRET",
  "AUTHORIZED_EMAIL",
  // Connexion Google : sans elles, la page de connexion ne mène nulle part.
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  // Accès des invités (échec fermé dans lib/accesHub) et résumé du hub (503).
  "HUB_TOKEN",
] as const;

export type VariableRequise = (typeof VARIABLES_REQUISES)[number];

/**
 * Noms des variables requises absentes, dans l'ordre de la liste. Une valeur vide ou faite
 * d'espaces compte comme absente (même règle que `isAuthConfigured`). Ne lit jamais la
 * VALEUR au-delà de ce test : elle ne sort pas de cette fonction.
 */
export function variablesManquantes(env: Env = process.env): VariableRequise[] {
  return VARIABLES_REQUISES.filter((nom) => !env[nom]?.trim());
}

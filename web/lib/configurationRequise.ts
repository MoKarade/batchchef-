// lib/configurationRequise.ts — listes FIGÉES des variables d'environnement contrôlées par
// la sonde publique `GET /api/sante/configuration` (F7, prévention INC-16).
//
// Deux niveaux (décision du gérant, 30/09/2026) :
//   - REQUISES : l'absence d'une seule bloque TOUT LE MONDE (base, connexion) → 503 ;
//   - DÉGRADANTES : l'absence ne bloque qu'une partie des utilisateurs (le propriétaire
//     passe toujours) → 200, signalée par un compte `degrade`.
//
// ⚠️ Listes écrites à la main, jamais dérivées d'un fichier `.env` : en production, aucun
// fichier de configuration n'est lu. Ajouter une variable ici = décider de son niveau.
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
] as const;

export const VARIABLES_DEGRADANTES = [
  // Accès des invités (échec fermé dans lib/accesHub) et résumé du hub (503). Le
  // propriétaire, vérifié d'abord par AUTHORIZED_EMAIL, entre quand même.
  "HUB_TOKEN",
] as const;

export type VariableRequise = (typeof VARIABLES_REQUISES)[number];
export type VariableDegradante = (typeof VARIABLES_DEGRADANTES)[number];

/** Vide ou fait d'espaces = absent (même règle que `isAuthConfigured`). */
function absentes<T extends string>(noms: readonly T[], env: Env): T[] {
  return noms.filter((nom) => !env[nom]?.trim());
}

/**
 * Noms des variables absentes, par niveau, dans l'ordre des listes. Ne lit jamais la
 * VALEUR au-delà du test de présence : elle ne sort pas de cette fonction.
 */
export function variablesManquantes(env: Env = process.env): {
  requises: VariableRequise[];
  degradantes: VariableDegradante[];
} {
  return {
    requises: absentes(VARIABLES_REQUISES, env),
    degradantes: absentes(VARIABLES_DEGRADANTES, env),
  };
}

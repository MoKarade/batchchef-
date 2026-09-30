// lib/authConfigured.ts — fail-closed : sans AUTH_SECRET/AUTHORIZED_EMAIL, Auth.js
// laisse passer en logguant MissingSecret (constaté sur le hub). App privée → sans
// config d'auth complète, on ne sert RIEN de protégé.

type Env = Record<string, string | undefined>;

const VARIABLES_AUTH = ["AUTH_SECRET", "AUTHORIZED_EMAIL"] as const;

/**
 * Noms des variables d'auth absentes (vide ou blanche = absente). Réservé au JOURNAL
 * serveur : ne jamais mettre ces noms dans une réponse HTTP (F7, INC-16).
 */
export function variablesAuthManquantes(env: Env = process.env): string[] {
  return VARIABLES_AUTH.filter((nom) => !env[nom]?.trim());
}

export function isAuthConfigured(env: Env = process.env): boolean {
  return variablesAuthManquantes(env).length === 0;
}

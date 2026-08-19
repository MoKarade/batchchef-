// La seule mémoire de l'OAuth : les `jti` déjà consommés (usage unique, OAuth 2.1).
//
// Le module `oauth.ts` est PUR et reçoit ce `consommer` en paramètre — c'est ce qui permet
// de le tester sans base. Ici vit le seul effet de bord.

import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Consommer } from "./oauth";

/**
 * Marque un `jti` consommé. Rend `false` s'il l'était DÉJÀ — c'est un rejeu.
 *
 * L'atomicité vient de la BASE, pas d'une lecture suivie d'une écriture : `ON CONFLICT DO
 * NOTHING` sur la clé primaire, puis on regarde si une ligne a été insérée. Un « lire puis
 * écrire » laisserait deux requêtes simultanées passer toutes les deux — exactement le
 * rejeu que ce garde doit empêcher, et c'est en concurrence qu'un attaquant essaierait.
 */
export const consommerJti: Consommer = async (jti, expireA) => {
  const res = await db
    .insert(schema.mcpOauthConsumed)
    .values({ jti, expiresAt: new Date(expireA) })
    .onConflictDoNothing()
    .returning({ jti: schema.mcpOauthConsumed.jti });
  return res.length > 0;
};

/**
 * Purge les lignes expirées. Sans effet sur la sécurité (la signature est déjà refusée sur
 * la date) : c'est de l'hygiène, pour que la table ne grossisse pas indéfiniment.
 * Best-effort — un échec ne doit jamais faire échouer un échange de jeton.
 */
export async function purgerJtiExpires(): Promise<void> {
  try {
    await db.delete(schema.mcpOauthConsumed).where(lt(schema.mcpOauthConsumed.expiresAt, sql`now()`));
  } catch {
    // Volontairement avalé, et c'est le SEUL endroit où je me le permets : cette purge est
    // cosmétique. La faire échouer bruyamment casserait une connexion pour une question de
    // ménage. Le garde d'usage unique, lui, ne pardonne rien.
  }
}

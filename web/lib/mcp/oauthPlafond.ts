// Plafond de tentatives sur la page de consentement OAuth.
//
// La fonction qui DÉCIDE est pure (`fenetreDe`, `PLAFOND_ECHECS`) ; seul le comptage touche
// la base. Elle vit en base et non en mémoire parce qu'en serverless un compteur de process
// est remis à zéro par la prochaine instance : il compterait à peu près jusqu'à trois, pour
// toujours.

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Échecs tolérés par fenêtre. Au-delà, la porte se ferme jusqu'à la fenêtre suivante. */
export const PLAFOND_ECHECS = 10;

/** Fenêtre d'une heure. PURE : l'instant est un paramètre, sinon le passage d'heure est intestable. */
export function fenetreDe(instant: Date): string {
  return instant.toISOString().slice(0, 13); // "AAAA-MM-JJTHH"
}

/** Le plafond est-il atteint pour cette fenêtre ? */
export async function porteFermee(instant: Date): Promise<boolean> {
  const [ligne] = await db
    .select({ echecs: schema.mcpOauthAttempts.echecs })
    .from(schema.mcpOauthAttempts)
    .where(eq(schema.mcpOauthAttempts.fenetre, fenetreDe(instant)));
  return (ligne?.echecs ?? 0) >= PLAFOND_ECHECS;
}

/** Enregistre UN échec. Incrément atomique : deux tentatives simultanées comptent pour deux. */
export async function noterEchec(instant: Date): Promise<void> {
  const fenetre = fenetreDe(instant);
  await db
    .insert(schema.mcpOauthAttempts)
    .values({ fenetre, echecs: 1 })
    .onConflictDoUpdate({
      target: schema.mcpOauthAttempts.fenetre,
      set: { echecs: sql`${schema.mcpOauthAttempts.echecs} + 1` },
    });
}

// lib/verifierMigrations.ts — la base contient-elle VRAIMENT les migrations du dépôt ? (fonction PURE)
//
// Pourquoi : `drizzle-kit migrate` peut sortir en code 0 sans rien appliquer (JobAI l'a vécu avec le pilote
// `@neondatabase/serverless`, WebSocket non configuré). `vercel-build` ne regardait que le code de retour : une
// migration manquante ne se serait vue qu'à la première requête qui touche la nouvelle colonne.
//
// La règle de Drizzle (pg-core/dialect.js, `migrate`) : une migration est appliquée seulement si son `when` du
// journal est PLUS GRAND que le `created_at` de la dernière ligne de `drizzle.__drizzle_migrations`. La vérité
// minimale est donc : le plus grand `created_at` de la table égale le plus grand `when` du journal du dépôt.
// Plus petit = la dernière migration n'est pas dans la base. Plus grand = la base est en avance sur ce code
// (rollback de code sur une base migrée) : on le dit aussi, ce n'est pas « à jour ».
//
// Une migration intermédiaire absente (rien d'autre que la dernière) est signalée en avertissement, pas en échec :
// un historique ancien baselined à la main ne doit pas bloquer la production sans qu'on l'ait vu.

export type MigrationAttendue = { tag: string; when: number };
export type LigneSuivi = { created_at: string | number | bigint };

export type VerdictMigrations =
  | { ok: true; message: string; avertissements: string[] }
  | { ok: false; message: string };

/**
 * @param attendues migrations du journal du dépôt (`meta/_journal.json`), dans l'ordre
 * @param lignes contenu de `drizzle.__drizzle_migrations`, ou `null` si la table n'existe pas
 */
export function verifierMigrations(attendues: readonly MigrationAttendue[], lignes: readonly LigneSuivi[] | null): VerdictMigrations {
  const derniere = attendues.reduce<MigrationAttendue | null>((max, m) => (max === null || m.when > max.when ? m : max), null);
  if (derniere === null) {
    return { ok: false, message: "Journal de migrations vide : rien à vérifier, ce n'est pas normal (dossier drizzle/ incomplet ?)." };
  }
  if (lignes === null) {
    return { ok: false, message: "La table drizzle.__drizzle_migrations n'existe pas : aucune migration n'a été appliquée." };
  }
  if (lignes.length === 0) {
    return { ok: false, message: "La table drizzle.__drizzle_migrations est vide : aucune migration n'a été appliquée." };
  }

  const datesBase = lignes.map((l) => Number(l.created_at));
  if (datesBase.some((d) => !Number.isFinite(d))) {
    return { ok: false, message: "La table drizzle.__drizzle_migrations contient un created_at illisible : état de la base non vérifiable." };
  }
  const derniereBase = Math.max(...datesBase);

  if (derniereBase < derniere.when) {
    return {
      ok: false,
      message: `La dernière migration du dépôt (${derniere.tag}, ${derniere.when}) n'est PAS dans la base (dernière appliquée : ${derniereBase}). ` +
        "drizzle-kit migrate a pu sortir en code 0 sans rien appliquer.",
    };
  }
  if (derniereBase > derniere.when) {
    return {
      ok: false,
      message: `La base est en AVANCE sur ce code (dernière appliquée : ${derniereBase}, dernière du dépôt : ${derniere.tag} ${derniere.when}) : ce déploiement est plus ancien que la base.`,
    };
  }

  const avertissements: string[] = [];
  const presentes = new Set(datesBase);
  const absentes = attendues.filter((m) => !presentes.has(m.when));
  if (absentes.length > 0) {
    avertissements.push(`${absentes.length} migration(s) du journal sans ligne dans la base : ${absentes.map((m) => m.tag).join(", ")}.`);
  }
  if (lignes.length !== attendues.length) {
    avertissements.push(`${lignes.length} ligne(s) dans la base pour ${attendues.length} migration(s) dans le dépôt.`);
  }
  return {
    ok: true,
    message: `Base à jour : dernière migration ${derniere.tag} (${derniere.when}) présente, ${lignes.length} ligne(s) de suivi pour ${attendues.length} migration(s) du dépôt.`,
    avertissements,
  };
}

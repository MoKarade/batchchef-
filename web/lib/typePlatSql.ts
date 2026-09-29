// lib/typePlatSql.ts — le type EFFECTIF d'une recette du catalogue, écrit en SQL.
//
// C'est la traduction SQL de `typeEffectif` (lib/typePlat.ts), et elle doit en garder la
// règle exacte : la correction de Marc l'emporte dès que la LIGNE de correction existe, même
// quand elle vaut `null` (« aucune de ces familles »).
//
// ⚠️ Pourquoi pas `coalesce(correction.type, type_estime)` : c'était la version précédente
// (SEM-BUG-TYPE-NUL, 29/09). Une correction à `null` y retombait sur l'estimation, et une
// recette que Marc avait sortie des familles restait tirée dans la semaine, affichée sous son
// ancien type. La présence de la ligne se lit sur sa clé, jamais sur sa valeur.
//
// Suppose la jointure `leftJoin(typeCorrections, eq(typeCorrections.sourceUrl,
// catalogRecipes.sourceUrl))` dans la requête qui l'emploie.

import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";

export function typeEffectifSql(): SQL<string | null> {
  return sql<string | null>`(case when ${schema.typeCorrections.id} is not null then ${schema.typeCorrections.type} else ${schema.catalogRecipes.typeEstime} end)`;
}

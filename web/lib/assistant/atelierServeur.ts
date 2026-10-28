// lib/assistant/atelierServeur.ts — l'assistant de recettes derrière l'atelier de LIA (I/O : base et modèle).
//
// Appelé par `POST /api/lia/ask` quand la demande porte `atelier: true` (page /assistant). La mise en forme est pure
// (`atelier.ts`) ; ici on lit les titres des recettes citées et on appelle la boucle. Aucune écriture : proposer un
// remplacement reste un bouton que Marc presse (Server Action `placerRecetteSemaine`).

import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DemandeAtelier, ReponseAtelier } from "@/lib/lia/contrat";
import { cleRecette, referencesATitrer, versReponseAtelier } from "./atelier";
import { repondre } from "./boucle";
import { validerMessage, type Message } from "./protocole";

/** Les titres des recettes citées, par clé `source#id`. Une recette absente de la base n'a pas d'entrée. */
export async function titresDesReferences(texte: string): Promise<Map<string, string>> {
  const refs = referencesATitrer(texte);
  const titres = new Map<string, string>();
  const ids = (source: "catalogue" | "mes-recettes") => refs.filter((r) => r.source === source).map((r) => r.id);

  const catalogue = ids("catalogue");
  if (catalogue.length > 0) {
    const lignes = await db
      .select({ id: schema.catalogRecipes.id, titre: schema.catalogRecipes.title })
      .from(schema.catalogRecipes)
      .where(inArray(schema.catalogRecipes.id, catalogue));
    for (const l of lignes) titres.set(cleRecette("catalogue", l.id), l.titre);
  }
  const miennes = ids("mes-recettes");
  if (miennes.length > 0) {
    const lignes = await db
      .select({ id: schema.recipes.id, titre: schema.recipes.title })
      .from(schema.recipes)
      .where(inArray(schema.recipes.id, miennes));
    for (const l of lignes) titres.set(cleRecette("mes-recettes", l.id), l.titre);
  }
  return titres;
}

export type ResultatAtelier = { ok: true; reponse: ReponseAtelier } | { ok: false; erreur: string };

/**
 * La question de l'atelier et ce qui s'est dit avant → la réponse de l'assistant, en texte et en blocs.
 *
 * L'historique vient du NAVIGATEUR : une donnée, filtrée ici (rôles connus seulement) puis tronquée par la boucle. Un échec du
 * moteur (clé absente, modèle en panne) devient `ok: false` avec sa raison : la route répond 503 et LIA dit « indisponible »,
 * jamais un texte inventé.
 */
export async function repondreAtelier(demande: Pick<DemandeAtelier, "question" | "historique">): Promise<ResultatAtelier> {
  const valide = validerMessage(demande.question);
  if (!valide.ok) return { ok: false, erreur: valide.erreur };
  const avant: Message[] = demande.historique
    .filter((m) => m.contenu.trim().length > 0)
    .map((m) => ({ role: m.role, contenu: m.contenu }));
  const reponse = await repondre([...avant, { role: "user", contenu: valide.message }]);
  if (!reponse.ok) return { ok: false, erreur: reponse.texte };
  const { text, blocks } = versReponseAtelier(reponse.texte, await titresDesReferences(reponse.texte));
  return { ok: true, reponse: { text, blocks } };
}

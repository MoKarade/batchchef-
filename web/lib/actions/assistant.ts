"use server";

// lib/actions/assistant.ts — question à l'assistant et fiche de recette ouverte depuis le chat.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatQty } from "@/lib/aggregate";
import { repondre } from "@/lib/assistant/boucle";
import { validerMessage, type Message } from "@/lib/assistant/protocole";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

/**
 * Une question à l'assistant.
 *
 * L'historique arrive du NAVIGATEUR : il est donc revalidé ici, et tronqué avant l'appel
 * (`tronquerHistorique` dans la boucle). Ne jamais faire confiance à sa longueur — c'est
 * une entrée qui croît à chaque tour.
 */
export async function demanderAAssistant(
  historique: Message[],
): Promise<ActionResult & { texte?: string; borneAtteinte?: boolean }> {
  try {
    await requireSession();
    if (!Array.isArray(historique) || historique.length === 0) {
      return { ok: false, error: "Rien à envoyer." };
    }
    const dernier = historique[historique.length - 1];
    if (!dernier || dernier.role !== "user") {
      return { ok: false, error: "Le dernier message doit être une question." };
    }
    const valide = validerMessage(dernier.contenu);
    if (!valide.ok) return { ok: false, error: valide.erreur };

    const propre: Message[] = historique
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, contenu: String(m.contenu ?? "").slice(0, 8000) }));

    const reponse = await repondre(propre);
    if (!reponse.ok) return { ok: false, error: reponse.texte };
    return { ok: true, texte: reponse.texte, borneAtteinte: reponse.borneAtteinte };
  } catch (err) {
    return fail(err);
  }
}

export interface FicheRecette {
  id: number;
  source: "catalogue" | "mes-recettes";
  titre: string;
  imageUrl: string | null;
  servings: number;
  instructions: string | null;
  ingredients: Array<{ nom: string; quantite: string; note: string | null }>;
}

/**
 * Lit une recette pour l'afficher SANS quitter le chat.
 *
 * Le chat vit dans l'état d'un composant client : naviguer vers /recettes/12 le détruirait,
 * et Marc perdrait la conversation qui vient de produire la suggestion. La fiche s'ouvre
 * donc PAR-DESSUS, et cette action ne fait que lire.
 */
export async function lireFicheRecette(
  id: number,
  source: "catalogue" | "mes-recettes",
): Promise<ActionResult & { fiche?: FicheRecette }> {
  try {
    await requireSession();
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Référence invalide." };
    const estCatalogue = source === "catalogue";
    const tableR = estCatalogue ? schema.catalogRecipes : schema.recipes;
    const tableI = estCatalogue ? schema.catalogIngredients : schema.recipeIngredients;
    const cleR = estCatalogue
      ? schema.catalogIngredients.catalogRecipeId
      : schema.recipeIngredients.recipeId;

    const [recette] = await db
      .select({
        titre: tableR.title,
        imageUrl: tableR.imageUrl,
        servings: tableR.servings,
        instructions: tableR.instructions,
      })
      .from(tableR)
      .where(eq(tableR.id, id));
    // Une carte vers du vide serait une promesse non tenue : on le DIT.
    if (!recette) return { ok: false, error: "Cette recette n'existe plus." };

    const ings = await db
      .select({ nom: tableI.name, qty: tableI.qty, unit: tableI.unit, note: tableI.note })
      .from(tableI)
      .where(eq(cleR, id));

    return {
      ok: true,
      fiche: {
        id,
        source,
        titre: recette.titre,
        imageUrl: recette.imageUrl,
        servings: recette.servings,
        instructions: recette.instructions,
        ingredients: ings.map((i) => ({
          nom: i.nom,
          quantite: formatQty(i.qty, i.unit),
          note: i.note,
        })),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

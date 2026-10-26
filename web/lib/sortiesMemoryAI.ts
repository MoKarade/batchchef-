// lib/sortiesMemoryAI.ts — BatchChef pousse ses sorties à MemoryAI (MoKarade/batchchef-#320).
//
// Un batch créé, une recette ajoutée au catalogue, une liste d'épicerie terminée : le SERVEUR envoie
// un événement à la porte `POST /api/sorties` de MemoryAI (ADR 0031 de MemoryAI), APRÈS le succès de
// l'écriture en base et hors du chemin de la réponse (`after()`).
//
// Échec fermé et muet : sans `MEMORYAI_SORTIES_TOKEN`, rien ne part ; une erreur réseau, un délai
// dépassé ou une réponse non 2xx est comptée dans un journal serveur SANS texte (ni titre, ni jeton,
// ni corps de réponse) et ne remonte jamais à l'appelant. L'app se reconnaît à son jeton : aucune clé
// `app` dans le corps.
//
// Fonctions pures d'un côté (constructeurs d'événements, `lignePropre`, `construireRef`), I/O de l'autre
// (`envoyerSorties`, `planifierSorties`).

import { after } from "next/server";

const URL_DEFAUT = "https://memoryai.hubperso.com";
const DELAI_MS = 2_500;
const MAX_PAR_ENVOI = 50;

type TypeSortie = "batch_cree" | "recette_ajoutee" | "liste_terminee";

export type EvenementSortie = {
  type: TypeSortie;
  date: string;
  titre: string;
  resume?: string;
  ref: string;
};

/**
 * Texte brut d'une seule ligne : espaces et caractères de contrôle ramenés à une espace, balises
 * retirées (`<`, `>`), coupé à `maximum` caractères (par point de code, jamais au milieu d'un
 * caractère). Un titre ou un résumé est une DONNÉE pour MemoryAI, jamais du balisage.
 */
export function lignePropre(texte: string, maximum: number): string {
  const nettoye = texte
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, " ")
    .trim();
  let sortie = "";
  for (const caractere of nettoye) {
    if (sortie.length + caractere.length > maximum) break;
    sortie += caractere;
  }
  return sortie.trim();
}

/** Identifiant d'objet pour la déduplication côté MemoryAI : ASCII imprimable, 80 au plus. */
export function construireRef(genre: "batch" | "recette" | "liste", id: number): string | null {
  if (!Number.isInteger(id) || id < 0) return null;
  return `batchchef-${genre}-${id}`;
}

function evenement(
  type: TypeSortie,
  ref: string | null,
  titre: string,
  resume: string,
  maintenant: Date,
): EvenementSortie | null {
  const titrePropre = lignePropre(titre, 120);
  if (ref === null || titrePropre.length === 0 || !Number.isFinite(maintenant.getTime())) {
    return null;
  }
  return {
    type,
    date: maintenant.toISOString(),
    titre: titrePropre,
    resume: lignePropre(resume, 600),
    ref,
  };
}

export function evenementBatchCree(
  batch: { id: number; nom: string; recettes: number; articles: number },
  maintenant: Date = new Date(),
): EvenementSortie | null {
  return evenement(
    "batch_cree",
    construireRef("batch", batch.id),
    `Batch créé · ${batch.nom}`,
    `${batch.recettes} recette${batch.recettes > 1 ? "s" : ""}, ${batch.articles} article${batch.articles > 1 ? "s" : ""} sur la liste d'épicerie.`,
    maintenant,
  );
}

export function evenementRecetteAjoutee(
  recette: { id: number; titre: string },
  maintenant: Date = new Date(),
): EvenementSortie | null {
  return evenement(
    "recette_ajoutee",
    construireRef("recette", recette.id),
    `Recette ajoutée · ${recette.titre}`,
    "Ajoutée à la bibliothèque depuis le catalogue.",
    maintenant,
  );
}

export function evenementListeTerminee(
  liste: { batchId: number; nom: string; articles: number },
  maintenant: Date = new Date(),
): EvenementSortie | null {
  return evenement(
    "liste_terminee",
    construireRef("liste", liste.batchId),
    `Liste d'épicerie terminée · ${liste.nom}`,
    `${liste.articles} article${liste.articles > 1 ? "s" : ""} cochés.`,
    maintenant,
  );
}

/** Journal serveur SANS texte : une raison fermée, au plus un statut HTTP et un compte. */
function journaliser(raison: string, details: Record<string, string | number> = {}): void {
  console.warn("[memoryai-sorties]", { raison, ...details });
}

/**
 * Envoie 1 à 50 événements. Ne lève JAMAIS : toute défaillance est comptée et absorbée. `fetchImpl`
 * et `env` existent pour les tests ; en production, `fetch` et `process.env`.
 */
export async function envoyerSorties(
  evenements: readonly EvenementSortie[],
  options: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  try {
    const env = options.env ?? process.env;
    const jeton = env.MEMORYAI_SORTIES_TOKEN?.trim();
    if (!jeton) return;
    if (evenements.length === 0 || evenements.length > MAX_PAR_ENVOI) return;

    let url: URL;
    try {
      url = new URL(`${(env.MEMORYAI_URL?.trim() || URL_DEFAUT).replace(/\/+$/, "")}/api/sorties`);
    } catch {
      journaliser("url_invalide");
      return;
    }
    if (url.protocol !== "https:") {
      journaliser("url_refusee");
      return;
    }

    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), DELAI_MS);
    try {
      const reponse = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "sorties", evenements }),
        cache: "no-store",
        signal: controleur.signal,
      });
      if (!reponse.ok) journaliser("reponse_http", { statut: reponse.status });
    } catch {
      journaliser(controleur.signal.aborted ? "delai_depasse" : "reseau");
    } finally {
      clearTimeout(minuterie);
    }
  } catch {
    journaliser("echec_inattendu");
  }
}

/**
 * Programme l'envoi APRÈS la réponse (`after()` de Next) : l'écriture de l'app n'attend jamais
 * MemoryAI. Hors d'une requête (tests, scripts), `after` lève : on retombe sur un envoi sans
 * attente. Ne lève jamais. Appeler seulement quand l'écriture en base a réussi.
 */
export function planifierSorties(evenements: ReadonlyArray<EvenementSortie | null>): void {
  const valides = evenements.filter((e): e is EvenementSortie => e !== null);
  if (valides.length === 0) return;
  try {
    for (let debut = 0; debut < valides.length; debut += MAX_PAR_ENVOI) {
      const lot = valides.slice(debut, debut + MAX_PAR_ENVOI);
      try {
        after(() => envoyerSorties(lot));
      } catch {
        void envoyerSorties(lot);
      }
    }
  } catch {
    journaliser("planification");
  }
}

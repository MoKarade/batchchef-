// lib/origine.ts — d'où vient une recette de la bibliothèque.
//
// Pourquoi ça existe : la bibliothèque mélange deux choses très différentes. Les recettes
// que Marc a AJOUTÉES lui-même (une vidéo qu'il a filmée, une page qu'il a trouvée) et
// celles piochées dans le CATALOGUE des 10 188 recettes importées en masse. Rien ne les
// distinguait à l'écran : « c'est moi qui l'ai ajoutée ? » n'avait pas de réponse.
//
// Fonctions PURES, sans I/O : c'est ce qui les rend testables et réutilisables par la page
// de détail comme par n'importe quelle liste future.

/** Les origines possibles. `null` en base = recette créée AVANT que l'on enregistre ça. */
export const ORIGINES = ["video", "page", "catalogue"] as const;
export type OrigineRecette = (typeof ORIGINES)[number];

/**
 * Garde d'entrée : une valeur venue du client (Server Action) n'est PAS de confiance.
 * Tout ce qui n'est pas une origine connue est traité comme inconnu, jamais deviné.
 */
export function estOrigine(valeur: unknown): valeur is OrigineRecette {
  return typeof valeur === "string" && (ORIGINES as readonly string[]).includes(valeur);
}

/**
 * Ce qui s'affiche sur la recette.
 *
 * ⚠️ Une origine absente rend « Origine non enregistrée », JAMAIS « ajoutée par toi ».
 * Les recettes créées avant cette colonne ne portent pas l'information : l'inventer
 * reviendrait à attribuer à Marc des recettes du catalogue qu'il n'a jamais choisies.
 */
export function libelleOrigine(origine: string | null | undefined): string {
  if (!estOrigine(origine)) return "Origine non enregistrée";
  switch (origine) {
    case "video":
      return "Ajoutée par toi, depuis une vidéo";
    case "page":
      return "Ajoutée par toi, depuis une page web";
    case "catalogue":
      return "Ajoutée depuis le catalogue";
  }
}

/** `true` quand c'est Marc qui a apporté la recette (par opposition au catalogue). */
export function ajouteeParMarc(origine: string | null | undefined): boolean {
  return origine === "video" || origine === "page";
}

/** Fuseau de Marc. Vercel tourne en UTC : sans ça, une recette ajoutée le soir daterait du lendemain. */
export const FUSEAU = "America/Toronto";

/**
 * Date d'ajout, lisible et dans le fuseau de Marc.
 *
 * ⚠️ Le fuseau n'est pas cosmétique : une recette enregistrée à 21 h heure du Québec est
 * déjà au lendemain en UTC. Afficher la date du serveur ferait mentir « ajoutée le … ».
 */
export function formatDateAjout(date: Date, fuseau = FUSEAU): string {
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: fuseau,
  }).format(date);
}
